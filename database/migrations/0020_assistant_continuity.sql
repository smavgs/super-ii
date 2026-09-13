begin;

create table if not exists app.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'recent' check (status in ('recent', 'archived')),
  project_label text check (project_label is null or char_length(project_label) between 1 and 120),
  page_path text check (page_path is null or (char_length(page_path) <= 500 and page_path ~ '^/')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_threads_profile_status_idx
  on app.assistant_threads (profile_id, status, updated_at desc);
create index if not exists assistant_threads_profile_project_idx
  on app.assistant_threads (profile_id, project_label, updated_at desc)
  where project_label is not null;

create table if not exists app.assistant_messages (
  sequence bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app.assistant_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  content_bytes integer generated always as (octet_length(content)) stored,
  provider text check (provider is null or char_length(provider) between 1 and 80),
  model text check (model is null or char_length(model) between 1 and 160),
  search_document tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_thread_sequence_idx
  on app.assistant_messages (thread_id, sequence);
create index if not exists assistant_messages_search_idx
  on app.assistant_messages using gin (search_document);

create table if not exists app.assistant_memory_preferences (
  profile_id uuid primary key references app.profiles(id) on delete cascade,
  memory_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists app.assistant_memory_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  source_thread_id uuid references app.assistant_threads(id) on delete set null,
  label text not null check (char_length(label) between 1 and 120),
  content text not null check (char_length(content) between 1 and 2000),
  search_document tsvector generated always as (to_tsvector('simple', label || ' ' || content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_memory_items_profile_idx
  on app.assistant_memory_items (profile_id, updated_at desc);
create index if not exists assistant_memory_items_search_idx
  on app.assistant_memory_items using gin (search_document);

create table if not exists app.assistant_usage_ledger (
  sequence bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  thread_id uuid,
  event_type text not null check (event_type in ('exchange_saved', 'thread_deleted', 'memory_saved', 'memory_deleted')),
  bytes_delta bigint not null,
  occurred_at timestamptz not null default now()
);
create index if not exists assistant_usage_ledger_profile_idx
  on app.assistant_usage_ledger (profile_id, sequence desc);

create or replace function app.assistant_storage_used_bytes(p_profile_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = app, pg_catalog
as $$
  select coalesce((
    select sum(octet_length(thread.title)
      + coalesce(octet_length(thread.project_label), 0)
      + coalesce(octet_length(thread.page_path), 0))::bigint
    from app.assistant_threads thread
    where thread.profile_id = p_profile_id
  ), 0)
  + coalesce((
    select sum(message.content_bytes)::bigint
    from app.assistant_messages message
    join app.assistant_threads thread on thread.id = message.thread_id
    where thread.profile_id = p_profile_id
  ), 0)
  + coalesce((
    select sum(octet_length(memory.label) + octet_length(memory.content))::bigint
    from app.assistant_memory_items memory
    where memory.profile_id = p_profile_id
  ), 0);
$$;

create or replace function app.profile_hosted_storage_used_bytes(p_profile_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = app, pg_catalog
as $$
  select app.assistant_storage_used_bytes(p_profile_id)
    + coalesce((
      select sum(repository.total_size_bytes)::bigint
      from app.repositories repository
      where repository.owner_profile_id = p_profile_id
    ), 0);
$$;

create or replace function app.persist_assistant_exchange(
  p_profile_id uuid,
  p_thread_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_provider text,
  p_model text,
  p_page_path text,
  p_limit_bytes bigint
)
returns table(thread_id uuid, storage_used_bytes bigint)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  resolved_thread_id uuid := p_thread_id;
  current_bytes bigint;
  added_bytes bigint;
  normalized_page_path text := nullif(left(trim(p_page_path), 500), '');
  generated_title text;
begin
  if p_profile_id is null
    or char_length(trim(p_user_content)) not between 1 and 2000
    or char_length(trim(p_assistant_content)) not between 1 and 4000
    or char_length(trim(p_provider)) not between 1 and 80
    or char_length(trim(p_model)) not between 1 and 160
  then
    raise exception 'assistant_exchange_invalid' using errcode = '22023';
  end if;

  if normalized_page_path is not null and normalized_page_path !~ '^/' then
    raise exception 'assistant_page_path_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));
  current_bytes := app.profile_hosted_storage_used_bytes(p_profile_id);
  added_bytes := octet_length(trim(p_user_content)) + octet_length(trim(p_assistant_content));

  if resolved_thread_id is null then
    generated_title := left(regexp_replace(trim(p_user_content), '\s+', ' ', 'g'), 96);
    added_bytes := added_bytes + octet_length(generated_title) + coalesce(octet_length(normalized_page_path), 0);
  elsif not exists (
    select 1 from app.assistant_threads thread
    where thread.id = resolved_thread_id and thread.profile_id = p_profile_id
  ) then
    raise exception 'assistant_thread_not_found' using errcode = 'P0002';
  end if;

  if p_limit_bytes is not null and current_bytes + added_bytes > p_limit_bytes then
    raise exception 'assistant_storage_limit_reached' using errcode = 'P0001';
  end if;

  if resolved_thread_id is null then
    insert into app.assistant_threads (profile_id, title, page_path)
    values (p_profile_id, generated_title, normalized_page_path)
    returning id into resolved_thread_id;
  end if;

  insert into app.assistant_messages (thread_id, role, content)
  values (resolved_thread_id, 'user', trim(p_user_content));

  insert into app.assistant_messages (thread_id, role, content, provider, model)
  values (resolved_thread_id, 'assistant', trim(p_assistant_content), trim(p_provider), trim(p_model));

  update app.assistant_threads
  set status = 'recent', updated_at = now()
  where id = resolved_thread_id;

  insert into app.assistant_usage_ledger (profile_id, thread_id, event_type, bytes_delta)
  values (p_profile_id, resolved_thread_id, 'exchange_saved', added_bytes);

  return query select resolved_thread_id, current_bytes + added_bytes;
end;
$$;

create or replace function app.delete_assistant_thread(p_profile_id uuid, p_thread_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  removed_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));
  select octet_length(thread.title)
      + coalesce(octet_length(thread.project_label), 0)
      + coalesce(octet_length(thread.page_path), 0)
      + coalesce(sum(message.content_bytes), 0)
  into removed_bytes
  from app.assistant_threads thread
  left join app.assistant_messages message on message.thread_id = thread.id
  where thread.id = p_thread_id and thread.profile_id = p_profile_id
  group by thread.id;

  if removed_bytes is null then
    return false;
  end if;

  delete from app.assistant_threads
  where id = p_thread_id and profile_id = p_profile_id;

  insert into app.assistant_usage_ledger (profile_id, thread_id, event_type, bytes_delta)
  values (p_profile_id, null, 'thread_deleted', -removed_bytes);
  return true;
end;
$$;

create or replace function app.set_assistant_thread_state(
  p_profile_id uuid,
  p_thread_id uuid,
  p_status text,
  p_project_label text
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if p_status not in ('recent', 'archived')
    or (
      p_project_label is not null
      and trim(p_project_label) <> ''
      and char_length(trim(p_project_label)) not between 1 and 120
    )
  then
    raise exception 'assistant_thread_state_invalid' using errcode = '22023';
  end if;
  update app.assistant_threads
  set status = p_status,
      project_label = nullif(trim(p_project_label), '')
  where id = p_thread_id and profile_id = p_profile_id;
  return found;
end;
$$;

create or replace function app.set_assistant_memory_enabled(p_profile_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  insert into app.assistant_memory_preferences (profile_id, memory_enabled)
  values (p_profile_id, p_enabled)
  on conflict (profile_id) do update
    set memory_enabled = excluded.memory_enabled, updated_at = now();
  return p_enabled;
end;
$$;

create or replace function app.add_assistant_memory(
  p_profile_id uuid,
  p_label text,
  p_content text,
  p_source_thread_id uuid,
  p_limit_bytes bigint
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  memory_id uuid;
  current_bytes bigint;
  added_bytes bigint;
begin
  if char_length(trim(p_label)) not between 1 and 120
    or char_length(trim(p_content)) not between 1 and 2000
  then
    raise exception 'assistant_memory_invalid' using errcode = '22023';
  end if;
  if p_source_thread_id is not null and not exists (
    select 1 from app.assistant_threads thread
    where thread.id = p_source_thread_id and thread.profile_id = p_profile_id
  ) then
    raise exception 'assistant_thread_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));
  current_bytes := app.profile_hosted_storage_used_bytes(p_profile_id);
  added_bytes := octet_length(trim(p_label)) + octet_length(trim(p_content));
  if p_limit_bytes is not null and current_bytes + added_bytes > p_limit_bytes then
    raise exception 'assistant_storage_limit_reached' using errcode = 'P0001';
  end if;

  insert into app.assistant_memory_items (profile_id, source_thread_id, label, content)
  values (p_profile_id, p_source_thread_id, trim(p_label), trim(p_content))
  returning id into memory_id;
  insert into app.assistant_usage_ledger (profile_id, thread_id, event_type, bytes_delta)
  values (p_profile_id, p_source_thread_id, 'memory_saved', added_bytes);
  return memory_id;
end;
$$;

create or replace function app.update_assistant_memory(
  p_profile_id uuid,
  p_memory_id uuid,
  p_label text,
  p_content text,
  p_limit_bytes bigint
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  current_bytes bigint;
  previous_bytes bigint;
  next_bytes bigint;
  byte_delta bigint;
begin
  if char_length(trim(p_label)) not between 1 and 120
    or char_length(trim(p_content)) not between 1 and 2000
  then
    raise exception 'assistant_memory_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));
  select octet_length(label) + octet_length(content)
  into previous_bytes
  from app.assistant_memory_items
  where id = p_memory_id and profile_id = p_profile_id;
  if previous_bytes is null then
    return false;
  end if;
  current_bytes := app.profile_hosted_storage_used_bytes(p_profile_id);
  next_bytes := octet_length(trim(p_label)) + octet_length(trim(p_content));
  byte_delta := next_bytes - previous_bytes;
  if p_limit_bytes is not null and current_bytes + byte_delta > p_limit_bytes then
    raise exception 'assistant_storage_limit_reached' using errcode = 'P0001';
  end if;
  update app.assistant_memory_items
  set label = trim(p_label), content = trim(p_content)
  where id = p_memory_id and profile_id = p_profile_id;
  if byte_delta <> 0 then
    insert into app.assistant_usage_ledger (profile_id, thread_id, event_type, bytes_delta)
    values (p_profile_id, null, 'memory_saved', byte_delta);
  end if;
  return true;
end;
$$;

create or replace function app.delete_assistant_memory(p_profile_id uuid, p_memory_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  removed_count integer;
  removed_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));
  select count(*)::integer, coalesce(sum(octet_length(label) + octet_length(content)), 0)::bigint
  into removed_count, removed_bytes
  from app.assistant_memory_items
  where profile_id = p_profile_id and (p_memory_id is null or id = p_memory_id);

  delete from app.assistant_memory_items
  where profile_id = p_profile_id and (p_memory_id is null or id = p_memory_id);

  if removed_count > 0 then
    insert into app.assistant_usage_ledger (profile_id, thread_id, event_type, bytes_delta)
    values (p_profile_id, null, 'memory_deleted', -removed_bytes);
  end if;
  return removed_count;
end;
$$;

create or replace function app.reject_assistant_message_mutation()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  raise exception 'assistant_messages_are_immutable' using errcode = '55000';
end;
$$;

create or replace function app.reject_assistant_usage_mutation()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  raise exception 'assistant_usage_ledger_is_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists assistant_threads_touch_updated_at on app.assistant_threads;
create trigger assistant_threads_touch_updated_at before update on app.assistant_threads
for each row execute function app.touch_updated_at();

drop trigger if exists assistant_memory_items_touch_updated_at on app.assistant_memory_items;
create trigger assistant_memory_items_touch_updated_at before update on app.assistant_memory_items
for each row execute function app.touch_updated_at();

drop trigger if exists assistant_messages_immutable on app.assistant_messages;
create trigger assistant_messages_immutable before update on app.assistant_messages
for each row execute function app.reject_assistant_message_mutation();

drop trigger if exists assistant_usage_ledger_immutable on app.assistant_usage_ledger;
create trigger assistant_usage_ledger_immutable before update or delete on app.assistant_usage_ledger
for each row execute function app.reject_assistant_usage_mutation();

alter table app.assistant_threads enable row level security;
alter table app.assistant_messages enable row level security;
alter table app.assistant_memory_preferences enable row level security;
alter table app.assistant_memory_items enable row level security;
alter table app.assistant_usage_ledger enable row level security;

commit;
