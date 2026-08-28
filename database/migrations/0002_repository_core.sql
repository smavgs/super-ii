begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'repository_revision_status') then
    create type repository_revision_status as enum (
      'draft',
      'quarantined',
      'scanning',
      'review',
      'published',
      'rejected'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'repository_review_decision') then
    create type repository_review_decision as enum (
      'pending',
      'approved',
      'changes_requested',
      'rejected'
    );
  end if;
end
$$;

create table if not exists app.repository_revisions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  parent_revision_id uuid,
  message text not null default '' check (char_length(message) <= 2000),
  status repository_revision_status not null default 'draft',
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'),
  file_count integer not null default 0 check (file_count >= 0),
  total_size_bytes bigint not null default 0 check (total_size_bytes >= 0),
  created_by text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repository_revisions_publish_state check (
    (status = 'published' and published_at is not null) or status <> 'published'
  ),
  unique (repository_id, sequence),
  unique (repository_id, id),
  foreign key (repository_id, parent_revision_id)
    references app.repository_revisions(repository_id, id)
);
create index if not exists repository_revisions_repository_created_idx
  on app.repository_revisions (repository_id, created_at desc);

create table if not exists app.repository_files (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null,
  path text not null check (
    char_length(path) between 1 and 1024
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '^/'
    and path !~ E'[\\\\]'
  ),
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text not null check (storage_key ~ '^(quarantine|objects)/[a-zA-Z0-9._/-]+$'),
  storage_state text not null default 'quarantine'
    check (storage_state in ('quarantine', 'available', 'rejected')),
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'running', 'clean', 'failed', 'error')),
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id) on delete cascade,
  unique (revision_id, path)
);
create index if not exists repository_files_repository_revision_idx
  on app.repository_files (repository_id, revision_id, path);
create index if not exists repository_files_sha256_idx
  on app.repository_files (sha256);

create table if not exists app.repository_file_inspections (
  id uuid primary key default gen_random_uuid(),
  repository_file_id uuid not null references app.repository_files(id) on delete cascade,
  inspector text not null check (inspector in (
    'clamav',
    'gitleaks',
    'format_policy',
    'safetensors',
    'datasets',
    'transformers',
    'tokenizers',
    'gguf',
    'diffusers'
  )),
  status text not null check (status in ('pending', 'running', 'passed', 'failed', 'skipped', 'error')),
  tool_version text,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint repository_file_inspections_completion check (
    (status in ('pending', 'running') and completed_at is null)
    or (status in ('passed', 'failed', 'skipped', 'error') and completed_at is not null)
  )
);
create index if not exists repository_file_inspections_file_idx
  on app.repository_file_inspections (repository_file_id, inspector, started_at desc);

create table if not exists app.repository_releases (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$'),
  notes text not null default '' check (char_length(notes) <= 100000),
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id),
  unique (repository_id, slug)
);
create index if not exists repository_releases_repository_idx
  on app.repository_releases (repository_id, created_at desc);

create table if not exists app.repository_tags (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null,
  name text not null check (name ~ '^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9])?$'),
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id),
  unique (repository_id, name)
);
create index if not exists repository_tags_repository_idx
  on app.repository_tags (repository_id, name);

create table if not exists app.repository_downloads (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid,
  repository_file_id uuid references app.repository_files(id) on delete set null,
  downloader_profile_id uuid references app.profiles(id) on delete set null,
  network_hash text check (network_hash is null or network_hash ~ '^[a-f0-9]{64}$'),
  user_agent text,
  bytes_sent bigint not null default 0 check (bytes_sent >= 0),
  created_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id)
);
create index if not exists repository_downloads_repository_created_idx
  on app.repository_downloads (repository_id, created_at desc);

create table if not exists app.repository_reviews (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null,
  reviewer_id text not null,
  decision repository_review_decision not null default 'pending',
  notes text not null default '' check (char_length(notes) <= 20000),
  security_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(security_summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id) on delete cascade,
  unique (revision_id, reviewer_id)
);
create index if not exists repository_reviews_revision_idx
  on app.repository_reviews (revision_id, decision, updated_at desc);

create or replace function app.create_repository_revision(
  p_repository_id uuid,
  p_parent_revision_id uuid,
  p_message text,
  p_created_by text
)
returns app.repository_revisions
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  next_sequence integer;
  new_revision app.repository_revisions;
begin
  perform 1 from app.repositories where id = p_repository_id for update;
  if not found then
    raise exception 'repository_not_found' using errcode = 'P0002';
  end if;

  if p_parent_revision_id is not null and not exists (
    select 1
    from app.repository_revisions
    where id = p_parent_revision_id and repository_id = p_repository_id
  ) then
    raise exception 'parent_revision_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from app.repository_revisions
  where repository_id = p_repository_id;

  insert into app.repository_revisions (
    repository_id,
    sequence,
    parent_revision_id,
    message,
    status,
    created_by
  ) values (
    p_repository_id,
    next_sequence,
    p_parent_revision_id,
    left(coalesce(p_message, ''), 2000),
    'draft',
    p_created_by
  ) returning * into new_revision;

  return new_revision;
end;
$$;

create or replace function app.publish_repository_revision(
  p_revision_id uuid,
  p_actor_id text
)
returns void
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_repository_id uuid;
  target_status public.repository_revision_status;
  target_manifest_sha256 text;
  target_file_count integer;
  target_total_size_bytes bigint;
  actual_file_count integer;
  actual_total_size_bytes bigint;
begin
  select repository_id, status, manifest_sha256, file_count, total_size_bytes
  into target_repository_id, target_status, target_manifest_sha256, target_file_count, target_total_size_bytes
  from app.repository_revisions
  where id = p_revision_id
  for update;

  if not found then
    raise exception 'revision_not_found' using errcode = 'P0002';
  end if;
  if target_status <> 'review' then
    raise exception 'revision_not_in_review' using errcode = 'P0001';
  end if;
  if not exists (select 1 from app.repository_files where revision_id = p_revision_id) then
    raise exception 'revision_has_no_files' using errcode = 'P0001';
  end if;
  select count(*)::integer, coalesce(sum(size_bytes), 0)
  into actual_file_count, actual_total_size_bytes
  from app.repository_files
  where revision_id = p_revision_id;
  if target_manifest_sha256 is null
    or target_file_count <> actual_file_count
    or target_total_size_bytes <> actual_total_size_bytes then
    raise exception 'revision_manifest_invalid' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from app.repository_files
    where revision_id = p_revision_id
      and (storage_state <> 'available' or scan_status <> 'clean')
  ) then
    raise exception 'revision_files_not_clean' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from app.repository_files f
    where f.revision_id = p_revision_id
      and (
        not exists (
          select 1 from app.repository_file_inspections i
          where i.repository_file_id = f.id and i.inspector = 'clamav' and i.status = 'passed'
        )
        or not exists (
          select 1 from app.repository_file_inspections i
          where i.repository_file_id = f.id and i.inspector = 'gitleaks' and i.status = 'passed'
        )
        or not exists (
          select 1 from app.repository_file_inspections i
          where i.repository_file_id = f.id and i.inspector = 'format_policy' and i.status = 'passed'
        )
      )
  ) then
    raise exception 'required_scans_not_passed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from app.repository_revision_analyses a
    join app.repositories r on r.id = a.repository_id
    where a.revision_id = p_revision_id
      and a.analysis_type = r.kind::text
      and a.status = 'passed'
  ) then
    raise exception 'repository_analysis_not_passed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from app.repository_reviews
    where revision_id = p_revision_id and decision = 'approved'
  ) or exists (
    select 1 from app.repository_reviews
    where revision_id = p_revision_id and decision in ('changes_requested', 'rejected')
  ) then
    raise exception 'revision_not_approved' using errcode = 'P0001';
  end if;

  update app.repository_revisions
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_revision_id;

  update app.repositories
  set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
  where id = target_repository_id;

  insert into app.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'repository_revision.published',
    'repository_revision',
    p_revision_id::text,
    jsonb_build_object('repository_id', target_repository_id)
  );
end;
$$;

drop trigger if exists repository_revisions_touch_updated_at on app.repository_revisions;
create trigger repository_revisions_touch_updated_at before update on app.repository_revisions
for each row execute function app.touch_updated_at();

drop trigger if exists repository_reviews_touch_updated_at on app.repository_reviews;
create trigger repository_reviews_touch_updated_at before update on app.repository_reviews
for each row execute function app.touch_updated_at();

alter table app.repository_revisions enable row level security;
alter table app.repository_files enable row level security;
alter table app.repository_file_inspections enable row level security;
alter table app.repository_releases enable row level security;
alter table app.repository_tags enable row level security;
alter table app.repository_downloads enable row level security;
alter table app.repository_reviews enable row level security;

drop policy if exists repository_revisions_public_read on app.repository_revisions;
create policy repository_revisions_public_read on app.repository_revisions
for select using (
  status = 'published'
  and exists (
    select 1 from app.repositories r
    where r.id = repository_id and r.visibility = 'public' and r.status = 'published'
  )
);

drop policy if exists repository_files_public_read on app.repository_files;
create policy repository_files_public_read on app.repository_files
for select using (
  storage_state = 'available'
  and scan_status = 'clean'
  and exists (
    select 1 from app.repository_revisions rr
    join app.repositories r on r.id = rr.repository_id
    where rr.id = revision_id
      and rr.status = 'published'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists repository_releases_public_read on app.repository_releases;
create policy repository_releases_public_read on app.repository_releases
for select using (
  exists (
    select 1 from app.repository_revisions rr
    join app.repositories r on r.id = rr.repository_id
    where rr.id = revision_id
      and rr.status = 'published'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists repository_tags_public_read on app.repository_tags;
create policy repository_tags_public_read on app.repository_tags
for select using (
  exists (
    select 1 from app.repository_revisions rr
    join app.repositories r on r.id = rr.repository_id
    where rr.id = revision_id
      and rr.status = 'published'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists repository_reviews_public_read on app.repository_reviews;
create policy repository_reviews_public_read on app.repository_reviews
for select using (
  decision = 'approved'
  and exists (
    select 1 from app.repository_revisions rr
    join app.repositories r on r.id = rr.repository_id
    where rr.id = revision_id
      and rr.status = 'published'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

commit;
