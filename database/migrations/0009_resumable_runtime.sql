begin;

alter table app.repository_uploads
  add column if not exists filename text,
  add column if not exists created_by text,
  add column if not exists protocol text not null default 'tus-1.0.0',
  add column if not exists offset_bytes bigint not null default 0,
  add column if not exists chunk_size_bytes integer not null default 33554432,
  add column if not exists capability_hash text,
  add column if not exists actual_sha256 text,
  add column if not exists repository_file_id uuid references app.repository_files(id) on delete set null,
  add column if not exists receipt jsonb not null default '{}'::jsonb,
  add column if not exists last_activity_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_protocol'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_protocol
      check (protocol = 'tus-1.0.0');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_offset'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_offset
      check (offset_bytes >= 0 and offset_bytes <= expected_size_bytes);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_chunk_size'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_chunk_size
      check (chunk_size_bytes between 1 and 33554432);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_capability_hash'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_capability_hash
      check (capability_hash is null or capability_hash ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_actual_sha256'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_actual_sha256
      check (actual_sha256 is null or actual_sha256 ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_uploads'::regclass
      and conname = 'repository_uploads_receipt_object'
  ) then
    alter table app.repository_uploads add constraint repository_uploads_receipt_object
      check (jsonb_typeof(receipt) = 'object');
  end if;
end
$$;

create index if not exists repository_uploads_activity_idx
  on app.repository_uploads (state, last_activity_at);
create unique index if not exists repository_uploads_provider_id_idx
  on app.repository_uploads (provider_upload_id)
  where provider_upload_id is not null;
alter table app.repository_uploads
  drop constraint if exists repository_uploads_revision_id_path_key;
create unique index if not exists repository_uploads_active_path_idx
  on app.repository_uploads (revision_id, path)
  where state not in ('rejected', 'aborted', 'expired');

alter table app.repository_files
  add column if not exists integrity_state text not null default 'unverified',
  add column if not exists integrity_verified_at timestamptz,
  add column if not exists integrity_receipt jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_files'::regclass
      and conname = 'repository_files_integrity_state'
  ) then
    alter table app.repository_files add constraint repository_files_integrity_state
      check (integrity_state in ('unverified', 'verified', 'corrupt'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_files'::regclass
      and conname = 'repository_files_integrity_receipt_object'
  ) then
    alter table app.repository_files add constraint repository_files_integrity_receipt_object
      check (jsonb_typeof(integrity_receipt) = 'object');
  end if;
end
$$;

create table if not exists app.cas_integrity_events (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  event_type text not null check (event_type in ('promoted', 'verified', 'deduplicated', 'corrupt', 'missing')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists cas_integrity_events_sha_idx
  on app.cas_integrity_events (sha256, occurred_at desc);

create table if not exists app.runtime_model_instances (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null references app.repository_revisions(id) on delete cascade,
  model_path text not null check (
    char_length(model_path) between 1 and 1024
    and model_path !~ '(^|/)\.\.(/|$)'
    and model_path !~ '^/'
    and model_path !~ E'[\\\\]'
  ),
  model_sha256 text not null check (model_sha256 ~ '^[a-f0-9]{64}$'),
  runtime text not null default 'llama.cpp' check (runtime = 'llama.cpp'),
  status text not null default 'starting'
    check (status in ('starting', 'ready', 'busy', 'stopping', 'stopped', 'failed', 'expired')),
  endpoint_id text,
  cold_start_ms integer check (cold_start_ms is null or cold_start_ms >= 0),
  request_count bigint not null default 0 check (request_count >= 0),
  last_used_at timestamptz,
  idle_expires_at timestamptz,
  failure_code text,
  runtime_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(runtime_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, model_path)
);
create index if not exists runtime_model_instances_status_idx
  on app.runtime_model_instances (status, last_used_at desc);

create table if not exists app.runtime_benchmark_records (
  id uuid primary key default gen_random_uuid(),
  category text not null check (
    category in ('storage', 'transfer', 'workspace', 'tokenizer', 'llama.cpp', 'mlx', 'browser')
  ),
  repository_id uuid references app.repositories(id) on delete set null,
  revision_id uuid references app.repository_revisions(id) on delete set null,
  runtime text not null,
  runtime_version text,
  model_sha256 text check (model_sha256 is null or model_sha256 ~ '^[a-f0-9]{64}$'),
  hardware jsonb not null check (jsonb_typeof(hardware) = 'object'),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  claim_scope text not null default 'local measurement only',
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists runtime_benchmark_records_category_idx
  on app.runtime_benchmark_records (category, measured_at desc);

create table if not exists app.notebook_execution_sessions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null references app.repository_revisions(id) on delete cascade,
  notebook_path text not null check (
    notebook_path ~ '\.ipynb$'
    and char_length(notebook_path) between 1 and 1024
    and notebook_path !~ '(^|/)\.\.(/|$)'
    and notebook_path !~ '^/'
    and notebook_path !~ E'[\\\\]'
  ),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'starting', 'running', 'succeeded', 'failed', 'stopping', 'stopped', 'expired')),
  container_name text unique,
  image_digest text,
  cpu_limit numeric(6,3) not null check (cpu_limit > 0),
  memory_limit_bytes bigint not null check (memory_limit_bytes > 0),
  pids_limit integer not null check (pids_limit >= 16),
  network_disabled boolean not null default true check (network_disabled),
  secrets_injected boolean not null default false check (not secrets_injected),
  timeout_seconds integer not null check (timeout_seconds between 5 and 3600),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[a-f0-9]{64}$'),
  exit_code integer,
  failure_code text,
  expires_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notebook_execution_sessions_profile_idx
  on app.notebook_execution_sessions (profile_id, created_at desc);
create index if not exists notebook_execution_sessions_expiry_idx
  on app.notebook_execution_sessions (status, expires_at);

create or replace function app.create_resumable_upload(
  p_repository_id uuid,
  p_revision_id uuid,
  p_uploader_profile_id uuid,
  p_path text,
  p_filename text,
  p_mime_type text,
  p_expected_size_bytes bigint,
  p_expected_sha256 text,
  p_capability_hash text,
  p_created_by text,
  p_expires_at timestamptz default now() + interval '24 hours',
  p_upload_id uuid default gen_random_uuid()
)
returns app.repository_uploads
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  upload_id uuid := p_upload_id;
  revision_status public.repository_revision_status;
  created app.repository_uploads;
begin
  if p_expected_size_bytes < 1 or p_expected_size_bytes > 10737418240 then
    raise exception 'upload_size_invalid' using errcode = '22023';
  end if;
  if p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_capability_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'upload_checksum_invalid' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then
    raise exception 'upload_expiry_invalid' using errcode = '22023';
  end if;

  select status into revision_status
  from app.repository_revisions
  where id = p_revision_id and repository_id = p_repository_id
  for update;
  if not found then
    raise exception 'revision_not_found' using errcode = 'P0002';
  end if;
  if revision_status not in ('draft', 'quarantined') then
    raise exception 'revision_not_writable' using errcode = '55000';
  end if;

  update app.repository_uploads
  set state = 'expired', completed_at = now(), updated_at = now()
  where revision_id = p_revision_id
    and path = p_path
    and expires_at <= now()
    and state in ('initiated', 'uploading', 'uploaded', 'scanning');

  insert into app.repository_uploads (
    id, repository_id, revision_id, uploader_profile_id, path, filename,
    mime_type, expected_size_bytes, expected_sha256, storage_backend,
    storage_key, provider_upload_id, state, capability_hash, created_by,
    expires_at
  ) values (
    upload_id, p_repository_id, p_revision_id, p_uploader_profile_id, p_path,
    left(p_filename, 255), p_mime_type, p_expected_size_bytes, p_expected_sha256,
    'runtime', 'quarantine/transfers/' || upload_id::text || '/payload',
    upload_id::text, 'initiated', p_capability_hash, p_created_by, p_expires_at
  )
  returning * into created;

  return created;
exception
  when unique_violation then
    raise exception 'upload_path_exists' using errcode = '23505';
end;
$$;

create or replace function app.advance_resumable_upload(
  p_upload_id uuid,
  p_expected_offset bigint,
  p_new_offset bigint
)
returns app.repository_uploads
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  current app.repository_uploads;
begin
  select * into current
  from app.repository_uploads
  where id = p_upload_id
  for update;
  if not found then
    raise exception 'upload_not_found' using errcode = 'P0002';
  end if;
  if current.expires_at <= now() then
    update app.repository_uploads
    set state = 'expired', updated_at = now()
    where id = p_upload_id;
    raise exception 'upload_expired' using errcode = '55000';
  end if;
  if current.state not in ('initiated', 'uploading', 'uploaded')
    or current.offset_bytes <> p_expected_offset
    or p_new_offset <= p_expected_offset
    or p_new_offset > current.expected_size_bytes then
    raise exception 'upload_offset_conflict' using errcode = '40001';
  end if;

  update app.repository_uploads
  set offset_bytes = p_new_offset,
      state = case when p_new_offset = expected_size_bytes then 'uploaded' else 'uploading' end,
      last_activity_at = now(),
      updated_at = now()
  where id = p_upload_id
  returning * into current;
  return current;
end;
$$;

create or replace function app.transition_resumable_upload(
  p_upload_id uuid,
  p_from_states text[],
  p_to_state text,
  p_actual_sha256 text default null,
  p_repository_file_id uuid default null,
  p_receipt jsonb default '{}'::jsonb,
  p_error_code text default null
)
returns app.repository_uploads
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  current app.repository_uploads;
begin
  if p_to_state not in ('initiated', 'uploading', 'uploaded', 'scanning', 'ready', 'rejected', 'aborted', 'expired')
    or jsonb_typeof(p_receipt) <> 'object'
    or (p_actual_sha256 is not null and p_actual_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception 'upload_transition_invalid' using errcode = '22023';
  end if;

  update app.repository_uploads
  set state = p_to_state,
      actual_sha256 = coalesce(p_actual_sha256, actual_sha256),
      repository_file_id = coalesce(p_repository_file_id, repository_file_id),
      receipt = p_receipt,
      error_code = p_error_code,
      completed_at = case when p_to_state in ('ready', 'rejected', 'aborted', 'expired') then now() else completed_at end,
      last_activity_at = now(),
      updated_at = now()
  where id = p_upload_id and state = any(p_from_states)
  returning * into current;
  if not found then
    raise exception 'upload_transition_conflict' using errcode = '40001';
  end if;
  return current;
end;
$$;

create or replace function app.expire_resumable_uploads()
returns integer
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  affected integer;
begin
  update app.repository_uploads
  set state = 'expired', completed_at = now(), updated_at = now()
  where expires_at <= now()
    and state in ('initiated', 'uploading', 'uploaded', 'scanning');
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function app.transition_notebook_execution(
  p_session_id uuid,
  p_from_states text[],
  p_to_state text,
  p_container_name text default null,
  p_result_sha256 text default null,
  p_exit_code integer default null,
  p_failure_code text default null
)
returns app.notebook_execution_sessions
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  current app.notebook_execution_sessions;
begin
  if p_to_state not in ('queued', 'starting', 'running', 'succeeded', 'failed', 'stopping', 'stopped', 'expired')
    or (p_result_sha256 is not null and p_result_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception 'notebook_transition_invalid' using errcode = '22023';
  end if;
  update app.notebook_execution_sessions
  set status = p_to_state,
      container_name = coalesce(p_container_name, container_name),
      result_sha256 = coalesce(p_result_sha256, result_sha256),
      exit_code = coalesce(p_exit_code, exit_code),
      failure_code = p_failure_code,
      started_at = case when p_to_state = 'running' then coalesce(started_at, now()) else started_at end,
      finished_at = case when p_to_state in ('succeeded', 'failed', 'stopped', 'expired') then now() else finished_at end,
      updated_at = now()
  where id = p_session_id and status = any(p_from_states)
  returning * into current;
  if not found then
    raise exception 'notebook_transition_conflict' using errcode = '40001';
  end if;
  return current;
end;
$$;

drop trigger if exists repository_uploads_touch_updated_at on app.repository_uploads;
create trigger repository_uploads_touch_updated_at before update on app.repository_uploads
for each row execute function app.touch_updated_at();

drop trigger if exists runtime_model_instances_touch_updated_at on app.runtime_model_instances;
create trigger runtime_model_instances_touch_updated_at before update on app.runtime_model_instances
for each row execute function app.touch_updated_at();

drop trigger if exists notebook_execution_sessions_touch_updated_at on app.notebook_execution_sessions;
create trigger notebook_execution_sessions_touch_updated_at before update on app.notebook_execution_sessions
for each row execute function app.touch_updated_at();

alter table app.cas_integrity_events enable row level security;
alter table app.runtime_model_instances enable row level security;
alter table app.runtime_benchmark_records enable row level security;
alter table app.notebook_execution_sessions enable row level security;

commit;
