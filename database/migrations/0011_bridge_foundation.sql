begin;

create table if not exists app.external_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  provider_subject text not null check (char_length(provider_subject) between 1 and 255),
  provider_username text not null check (char_length(provider_username) between 1 and 255),
  display_name text,
  avatar_url text,
  scopes text[] not null default '{}',
  organizations jsonb not null default '[]'::jsonb check (jsonb_typeof(organizations) = 'array'),
  access_token_ciphertext text,
  access_token_nonce text,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  last_verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);
create index if not exists external_identities_profile_idx
  on app.external_identities (profile_id, provider, revoked_at);

create table if not exists app.bridge_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  verifier_ciphertext text not null,
  verifier_nonce text not null,
  requested_scopes text[] not null,
  return_path text not null default '/bring-my-work'
    check (return_path ~ '^/[a-zA-Z0-9/_?&=.-]{0,255}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bridge_oauth_states_expiry_idx
  on app.bridge_oauth_states (expires_at) where consumed_at is null;

create table if not exists app.namespace_claims (
  id uuid primary key default gen_random_uuid(),
  external_identity_id uuid not null references app.external_identities(id) on delete cascade,
  profile_id uuid references app.profiles(id) on delete cascade,
  organization_id uuid references app.organizations(id) on delete cascade,
  provider text not null,
  provider_namespace text not null check (char_length(provider_namespace) between 1 and 255),
  target_handle text not null check (
    target_handle ~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$'
  ),
  namespace_kind text not null check (namespace_kind in ('personal', 'organization')),
  provider_role text,
  status text not null default 'verified'
    check (status in ('pending', 'verified', 'rejected', 'released')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  verified_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint namespace_claim_target check (
    (namespace_kind = 'personal' and profile_id is not null and organization_id is null)
    or (namespace_kind = 'organization' and profile_id is null and organization_id is not null)
  )
);
create unique index if not exists namespace_claims_provider_active_idx
  on app.namespace_claims (provider, lower(provider_namespace), namespace_kind)
  where status in ('pending', 'verified');
create unique index if not exists namespace_claims_target_active_idx
  on app.namespace_claims (lower(target_handle), namespace_kind)
  where status in ('pending', 'verified');

create table if not exists app.bridge_import_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  external_identity_id uuid references app.external_identities(id) on delete set null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  source_url text not null check (source_url ~ '^https://'),
  request_key text not null check (request_key ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'review', 'complete', 'failed', 'cancelled')),
  selected_count integer not null default 0 check (selected_count between 0 and 50),
  file_count integer not null default 0 check (file_count >= 0),
  total_size_bytes bigint not null default 0 check (total_size_bytes >= 0),
  progress_bytes bigint not null default 0 check (progress_bytes >= 0),
  ownership_attested boolean not null check (ownership_attested),
  source_unchanged boolean not null default true check (source_unchanged),
  retry_count integer not null default 0 check (retry_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  cancel_requested_at timestamptz,
  error_code text,
  error_detail text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, request_key)
);
create index if not exists bridge_import_jobs_worker_idx
  on app.bridge_import_jobs (status, next_attempt_at, created_at);
create unique index if not exists bridge_import_jobs_profile_active_idx
  on app.bridge_import_jobs (profile_id)
  where status in ('queued', 'running');

create table if not exists app.bridge_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.bridge_import_jobs(id) on delete cascade,
  repository_id uuid references app.repositories(id) on delete set null,
  revision_id uuid references app.repository_revisions(id) on delete set null,
  provider_repo_id text not null check (provider_repo_id ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  source_namespace text not null check (char_length(source_namespace) between 1 and 255),
  source_slug text not null check (char_length(source_slug) between 1 and 255),
  source_revision text not null check (source_revision ~ '^[a-fA-F0-9]{40,64}$'),
  source_url text not null check (source_url ~ '^https://'),
  kind public.repository_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  license text,
  source_visibility text not null default 'public'
    check (source_visibility in ('public', 'private', 'gated')),
  file_count integer not null check (file_count between 1 and 5000),
  total_size_bytes bigint not null check (total_size_bytes between 1 and 21474836480),
  largest_file_bytes bigint not null check (largest_file_bytes between 0 and 10737418240),
  status text not null default 'queued'
    check (status in ('queued', 'downloading', 'scanning', 'review', 'complete', 'blocked', 'failed', 'cancelled')),
  blocked_reason text,
  progress_bytes bigint not null default 0 check (progress_bytes >= 0),
  error_code text,
  error_detail text,
  source_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(source_metadata) = 'object'),
  source_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(source_manifest) = 'array'),
  imported_manifest_sha256 text check (
    imported_manifest_sha256 is null or imported_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, provider_repo_id, source_revision)
);
create index if not exists bridge_import_items_job_idx
  on app.bridge_import_items (job_id, status, created_at);

create table if not exists app.repository_sources (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null references app.repository_revisions(id) on delete cascade,
  destination_profile_id uuid not null references app.profiles(id) on delete cascade,
  external_identity_id uuid references app.external_identities(id) on delete set null,
  provider text not null,
  provider_repo_id text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_revision text not null check (source_revision ~ '^[a-fA-F0-9]{40,64}$'),
  observed_license text,
  source_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(source_manifest) = 'array'),
  imported_manifest_sha256 text not null check (imported_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz not null default now(),
  unique (revision_id),
  unique (destination_profile_id, provider, provider_repo_id, source_revision)
);
create index if not exists repository_sources_lookup_idx
  on app.repository_sources (destination_profile_id, provider, provider_repo_id, imported_at desc);

create table if not exists app.bridge_sync_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  external_identity_id uuid references app.external_identities(id) on delete set null,
  provider text not null,
  provider_repo_id text not null,
  kind public.repository_kind not null,
  source_url text not null check (source_url ~ '^https://'),
  last_seen_revision text not null check (last_seen_revision ~ '^[a-fA-F0-9]{40,64}$'),
  last_import_job_id uuid references app.bridge_import_jobs(id) on delete set null,
  enabled boolean not null default true,
  check_interval_seconds integer not null default 3600 check (check_interval_seconds between 900 and 86400),
  next_check_at timestamptz not null default now(),
  last_checked_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 20),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, provider, provider_repo_id)
);
create index if not exists bridge_sync_subscriptions_due_idx
  on app.bridge_sync_subscriptions (next_check_at) where enabled;

create table if not exists app.bridge_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.bridge_import_jobs(id) on delete cascade,
  item_id uuid references app.bridge_import_items(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 120),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists bridge_events_job_idx
  on app.bridge_events (job_id, occurred_at desc);

create or replace function app.create_bridge_import(
  p_profile_id uuid,
  p_provider text,
  p_external_identity_id uuid,
  p_source_url text,
  p_items jsonb,
  p_ownership_attested boolean
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  new_job_id uuid;
  existing_job_id uuid;
  request_key_value text;
  item jsonb;
  item_count integer;
  aggregate_size bigint := 0;
begin
  if p_provider <> 'huggingface' or p_source_url !~ '^https://huggingface[.]co/' then
    raise exception 'bridge_provider_not_supported' using errcode = 'P0001';
  end if;
  if not p_ownership_attested then
    raise exception 'bridge_attestation_required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'bridge_items_invalid' using errcode = 'P0001';
  end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 50 then
    raise exception 'bridge_item_count_invalid' using errcode = 'P0001';
  end if;
  if p_external_identity_id is not null and not exists (
    select 1 from app.external_identities
    where id = p_external_identity_id and profile_id = p_profile_id and revoked_at is null
  ) then
    raise exception 'bridge_identity_invalid' using errcode = 'P0001';
  end if;

  request_key_value := encode(public.digest(
    p_profile_id::text || '|' || p_provider || '|' || p_items::text,
    'sha256'
  ), 'hex');
  select id into existing_job_id
  from app.bridge_import_jobs
  where profile_id = p_profile_id and request_key = request_key_value;
  if existing_job_id is not null then
    return existing_job_id;
  end if;
  if exists (
    select 1 from app.bridge_import_jobs
    where profile_id = p_profile_id and status in ('queued', 'running')
  ) then
    raise exception 'bridge_import_in_progress' using errcode = 'P0001';
  end if;

  insert into app.bridge_import_jobs (
    profile_id, external_identity_id, provider, source_url, request_key,
    selected_count, ownership_attested
  ) values (
    p_profile_id, p_external_identity_id, p_provider, p_source_url, request_key_value,
    item_count, true
  ) returning id into new_job_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(item->>'provider_repo_id', '') !~ '^[^/[:space:]]+/[^/[:space:]]+$'
      or coalesce(item->>'source_revision', '') !~ '^[a-fA-F0-9]{40,64}$'
      or coalesce(item->>'source_url', '') !~ '^https://huggingface[.]co/'
      or coalesce(item->>'kind', '') not in ('model', 'dataset', 'space')
      or coalesce((item->>'file_count')::integer, 0) not between 1 and 5000
      or coalesce((item->>'total_size_bytes')::bigint, 0) not between 1 and 21474836480
      or coalesce((item->>'largest_file_bytes')::bigint, 0) not between 0 and 10737418240
      or nullif(item->>'blocked_reason', '') is not null then
      raise exception 'bridge_item_not_ready' using errcode = 'P0001';
    end if;
    aggregate_size := aggregate_size + (item->>'total_size_bytes')::bigint;
    insert into app.bridge_import_items (
      job_id, provider_repo_id, source_namespace, source_slug, source_revision,
      source_url, kind, title, summary, license, source_visibility, file_count,
      total_size_bytes, largest_file_bytes, source_metadata, source_manifest
    ) values (
      new_job_id,
      item->>'provider_repo_id',
      split_part(item->>'provider_repo_id', '/', 1),
      split_part(item->>'provider_repo_id', '/', 2),
      lower(item->>'source_revision'),
      item->>'source_url',
      (item->>'kind')::public.repository_kind,
      left(coalesce(nullif(item->>'title', ''), split_part(item->>'provider_repo_id', '/', 2)), 200),
      left(coalesce(item->>'summary', ''), 2000),
      nullif(left(coalesce(item->>'license', ''), 120), ''),
      coalesce(nullif(item->>'source_visibility', ''), 'public'),
      (item->>'file_count')::integer,
      (item->>'total_size_bytes')::bigint,
      (item->>'largest_file_bytes')::bigint,
      coalesce(item->'source_metadata', '{}'::jsonb),
      coalesce(item->'source_manifest', '[]'::jsonb)
    );
  end loop;
  if aggregate_size > 26843545600 then
    raise exception 'bridge_import_size_limit' using errcode = 'P0001';
  end if;
  update app.bridge_import_jobs
  set total_size_bytes = aggregate_size,
      file_count = (select coalesce(sum(file_count), 0)::integer from app.bridge_import_items where job_id = new_job_id)
  where id = new_job_id;
  insert into app.bridge_events (job_id, event_type, detail)
  values (new_job_id, 'import.queued', jsonb_build_object('selected_count', item_count));
  return new_job_id;
end;
$$;

create or replace function app.claim_next_bridge_import()
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from app.bridge_import_jobs
  where status = 'queued' and next_attempt_at <= now() and cancel_requested_at is null
  order by created_at
  for update skip locked
  limit 1;
  if claimed_id is null then
    return null;
  end if;
  update app.bridge_import_jobs
  set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where id = claimed_id;
  insert into app.bridge_events (job_id, event_type) values (claimed_id, 'import.started');
  return claimed_id;
end;
$$;

create or replace function app.prepare_bridge_item(p_item_id uuid)
returns table (repository_id uuid, revision_id uuid, already_imported boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  target_item app.bridge_import_items;
  target_job app.bridge_import_jobs;
  existing_source app.repository_sources;
  existing_branch app.repository_branches;
  created_repository record;
  created_revision app.repository_revisions;
begin
  select * into target_item from app.bridge_import_items where id = p_item_id for update;
  if target_item.id is null or target_item.status not in ('downloading', 'scanning') then
    raise exception 'bridge_item_not_claimed' using errcode = 'P0001';
  end if;
  select * into target_job from app.bridge_import_jobs where id = target_item.job_id for update;
  if target_job.cancel_requested_at is not null then
    update app.bridge_import_items set status = 'cancelled', completed_at = now(), updated_at = now()
    where id = p_item_id;
    return;
  end if;

  select source.* into existing_source
  from app.repository_sources source
  where source.destination_profile_id = target_job.profile_id
    and source.provider = target_job.provider
    and source.provider_repo_id = target_item.provider_repo_id
  order by source.imported_at desc
  limit 1;

  if existing_source.id is not null and lower(existing_source.source_revision) = lower(target_item.source_revision) then
    update app.bridge_import_items
    set repository_id = existing_source.repository_id,
        revision_id = existing_source.revision_id,
        status = 'complete',
        progress_bytes = total_size_bytes,
        imported_manifest_sha256 = existing_source.imported_manifest_sha256,
        completed_at = now(),
        updated_at = now()
    where id = p_item_id;
    repository_id := existing_source.repository_id;
    revision_id := existing_source.revision_id;
    already_imported := true;
    return next;
    return;
  end if;

  if existing_source.id is not null then
    select * into existing_branch
    from app.repository_branches
    where repository_branches.repository_id = existing_source.repository_id and is_default
    for update;
    select * into created_revision
    from app.create_repository_revision(
      existing_source.repository_id,
      existing_branch.head_revision_id,
      'Bridge sync from ' || target_job.provider || ' revision ' || target_item.source_revision,
      'bridge:' || target_job.profile_id::text
    );
    update app.repository_revisions set branch_id = existing_branch.id where id = created_revision.id;
    repository_id := existing_source.repository_id;
    revision_id := created_revision.id;
  else
    if exists (
      select 1 from app.repositories
      where owner_profile_id = target_job.profile_id and lower(slug) = lower(target_item.source_slug)
    ) then
      raise exception 'bridge_destination_conflict' using errcode = 'P0001';
    end if;
    select * into created_repository
    from app.create_repository_with_revision(
      target_job.profile_id,
      null,
      target_item.kind,
      lower(target_item.source_slug),
      target_item.title,
      case when target_item.summary = '' then
        'Imported through Super ii Bridge from ' || target_item.provider_repo_id || '.'
      else target_item.summary end,
      target_item.license,
      null,
      null,
      null,
      '',
      jsonb_build_object(
        'bridge', jsonb_build_object(
          'provider', target_job.provider,
          'source_url', target_item.source_url,
          'source_revision', target_item.source_revision,
          'source_unchanged', true
        )
      )
    );
    repository_id := created_repository.repository_id;
    revision_id := created_repository.revision_id;
  end if;
  update app.bridge_import_items
  set repository_id = prepare_bridge_item.repository_id,
      revision_id = prepare_bridge_item.revision_id,
      status = 'scanning',
      updated_at = now()
  where id = p_item_id;
  already_imported := false;
  return next;
end;
$$;

create or replace function app.complete_bridge_item(
  p_item_id uuid,
  p_card_markdown text,
  p_source_manifest jsonb
)
returns text
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_item app.bridge_import_items;
  target_job app.bridge_import_jobs;
  revision_manifest_sha text;
begin
  select * into target_item from app.bridge_import_items where id = p_item_id for update;
  if target_item.id is null or target_item.repository_id is null or target_item.revision_id is null then
    raise exception 'bridge_item_repository_missing' using errcode = 'P0001';
  end if;
  select * into target_job from app.bridge_import_jobs where id = target_item.job_id;
  select manifest_sha256 into revision_manifest_sha
  from app.repository_revisions
  where id = target_item.revision_id and repository_id = target_item.repository_id and status = 'review';
  if revision_manifest_sha is null then
    raise exception 'bridge_revision_not_ready' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_source_manifest) <> 'array' then
    raise exception 'bridge_source_manifest_invalid' using errcode = 'P0001';
  end if;

  update app.repositories
  set card_markdown = left(coalesce(p_card_markdown, ''), 100000),
      provenance = provenance || jsonb_build_object(
        'bridge', jsonb_build_object(
          'provider', target_job.provider,
          'source_url', target_item.source_url,
          'source_revision', target_item.source_revision,
          'imported_at', now(),
          'source_unchanged', true
        )
      )
  where id = target_item.repository_id;

  insert into app.repository_sources (
    repository_id, revision_id, destination_profile_id, external_identity_id,
    provider, provider_repo_id, source_url, source_revision, observed_license,
    source_manifest, imported_manifest_sha256
  ) values (
    target_item.repository_id, target_item.revision_id, target_job.profile_id,
    target_job.external_identity_id, target_job.provider, target_item.provider_repo_id,
    target_item.source_url, target_item.source_revision, target_item.license,
    p_source_manifest, revision_manifest_sha
  ) on conflict (revision_id) do nothing;

  update app.repository_branches
  set head_revision_id = target_item.revision_id, updated_at = now()
  where repository_id = target_item.repository_id and is_default;
  update app.bridge_import_items
  set status = 'review', progress_bytes = total_size_bytes,
      source_manifest = p_source_manifest,
      imported_manifest_sha256 = revision_manifest_sha,
      completed_at = now(), updated_at = now()
  where id = p_item_id;
  update app.bridge_sync_subscriptions
  set last_seen_revision = target_item.source_revision,
      last_import_job_id = target_job.id,
      last_checked_at = now(),
      next_check_at = now() + make_interval(secs => check_interval_seconds),
      consecutive_failures = 0,
      last_error_code = null,
      updated_at = now()
  where repository_id = target_item.repository_id
    and provider = target_job.provider
    and provider_repo_id = target_item.provider_repo_id;
  insert into app.bridge_events (job_id, item_id, event_type, detail)
  values (
    target_job.id, p_item_id, 'item.awaiting_review',
    jsonb_build_object('repository_id', target_item.repository_id, 'revision_id', target_item.revision_id, 'manifest_sha256', revision_manifest_sha)
  );
  return app.refresh_bridge_import(target_job.id);
end;
$$;

create or replace function app.set_bridge_sync(
  p_profile_id uuid,
  p_repository_id uuid,
  p_enabled boolean
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  source_row app.repository_sources;
  subscription_id uuid;
begin
  if not exists (
    select 1 from app.repositories
    where id = p_repository_id and owner_profile_id = p_profile_id
  ) then
    raise exception 'bridge_repository_not_owned' using errcode = '42501';
  end if;
  select * into source_row
  from app.repository_sources
  where repository_id = p_repository_id and destination_profile_id = p_profile_id
  order by imported_at desc limit 1;
  if source_row.id is null then
    raise exception 'bridge_source_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from app.bridge_import_items
    where revision_id = source_row.revision_id and source_visibility = 'public'
  ) then
    raise exception 'bridge_sync_public_only' using errcode = 'P0001';
  end if;
  insert into app.bridge_sync_subscriptions (
    profile_id, repository_id, external_identity_id, provider, provider_repo_id,
    kind, source_url, last_seen_revision, enabled, next_check_at
  )
  select
    p_profile_id, p_repository_id, source_row.external_identity_id, source_row.provider,
    source_row.provider_repo_id, repository.kind, source_row.source_url,
    source_row.source_revision, p_enabled, now()
  from app.repositories repository where repository.id = p_repository_id
  on conflict (repository_id, provider, provider_repo_id)
  do update set enabled = excluded.enabled,
    external_identity_id = excluded.external_identity_id,
    next_check_at = case when excluded.enabled then now() else bridge_sync_subscriptions.next_check_at end,
    updated_at = now()
  returning id into subscription_id;
  return subscription_id;
end;
$$;

create or replace function app.claim_next_bridge_item(p_job_id uuid)
returns app.bridge_import_items
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  claimed app.bridge_import_items;
begin
  if exists (
    select 1 from app.bridge_import_jobs
    where id = p_job_id and cancel_requested_at is not null
  ) then
    update app.bridge_import_items set status = 'cancelled', completed_at = now(), updated_at = now()
    where job_id = p_job_id and status = 'queued';
    update app.bridge_import_jobs set status = 'cancelled', completed_at = now(), updated_at = now()
    where id = p_job_id;
    return null;
  end if;
  select * into claimed
  from app.bridge_import_items
  where job_id = p_job_id and status = 'queued'
  order by created_at
  for update skip locked
  limit 1;
  if claimed.id is null then
    return null;
  end if;
  update app.bridge_import_items
  set status = 'downloading', started_at = coalesce(started_at, now()), updated_at = now()
  where id = claimed.id returning * into claimed;
  insert into app.bridge_events (job_id, item_id, event_type)
  values (p_job_id, claimed.id, 'item.downloading');
  return claimed;
end;
$$;

create or replace function app.refresh_bridge_import(p_job_id uuid)
returns text
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  next_status text;
begin
  if exists (select 1 from app.bridge_import_items where job_id = p_job_id and status in ('queued', 'downloading', 'scanning')) then
    next_status := 'running';
  elsif exists (select 1 from app.bridge_import_items where job_id = p_job_id and status = 'failed') then
    next_status := 'failed';
  elsif exists (select 1 from app.bridge_import_items where job_id = p_job_id and status = 'cancelled') then
    next_status := 'cancelled';
  elsif exists (select 1 from app.bridge_import_items where job_id = p_job_id and status = 'review') then
    next_status := 'review';
  else
    next_status := 'complete';
  end if;
  update app.bridge_import_jobs
  set status = next_status,
      progress_bytes = (
        select coalesce(sum(least(progress_bytes, total_size_bytes)), 0)
        from app.bridge_import_items where job_id = p_job_id
      ),
      completed_at = case when next_status in ('review', 'complete', 'failed', 'cancelled') then coalesce(completed_at, now()) else null end,
      updated_at = now()
  where id = p_job_id;
  return next_status;
end;
$$;

create or replace function app.set_bridge_item_state(
  p_item_id uuid,
  p_status text,
  p_progress_bytes bigint,
  p_error_code text,
  p_error_detail text
)
returns text
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_job_id uuid;
begin
  if p_status not in ('downloading', 'scanning', 'review', 'complete', 'blocked', 'failed', 'cancelled') then
    raise exception 'bridge_item_state_invalid' using errcode = 'P0001';
  end if;
  update app.bridge_import_items
  set status = p_status,
      progress_bytes = greatest(0, least(coalesce(p_progress_bytes, progress_bytes), total_size_bytes)),
      error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      error_detail = nullif(left(coalesce(p_error_detail, ''), 2000), ''),
      completed_at = case when p_status in ('review', 'complete', 'blocked', 'failed', 'cancelled') then now() else null end,
      updated_at = now()
  where id = p_item_id
  returning job_id into target_job_id;
  if target_job_id is null then
    raise exception 'bridge_item_not_found' using errcode = 'P0002';
  end if;
  insert into app.bridge_events (job_id, item_id, event_type, detail)
  values (
    target_job_id,
    p_item_id,
    'item.' || p_status,
    jsonb_strip_nulls(jsonb_build_object('error_code', nullif(p_error_code, '')))
  );
  return app.refresh_bridge_import(target_job_id);
end;
$$;

create or replace function app.request_bridge_import_cancel(
  p_job_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  update app.bridge_import_jobs
  set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
  where id = p_job_id and profile_id = p_profile_id and status in ('queued', 'running');
  if not found then
    return false;
  end if;
  update app.bridge_import_items
  set status = 'cancelled', completed_at = now(), updated_at = now()
  where job_id = p_job_id and status = 'queued';
  insert into app.bridge_events (job_id, event_type) values (p_job_id, 'import.cancel_requested');
  perform app.refresh_bridge_import(p_job_id);
  return true;
end;
$$;

create or replace function app.claim_personal_namespace(
  p_profile_id uuid,
  p_external_identity_id uuid,
  p_target_handle text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  identity_row app.external_identities;
  current_handle text;
  normalized_handle text := lower(trim(p_target_handle));
  claim_id uuid;
begin
  select * into identity_row from app.external_identities
  where id = p_external_identity_id and profile_id = p_profile_id and revoked_at is null
  for update;
  if identity_row.id is null or lower(identity_row.provider_username) <> normalized_handle then
    raise exception 'namespace_identity_mismatch' using errcode = 'P0001';
  end if;
  if normalized_handle !~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$' then
    raise exception 'namespace_handle_invalid' using errcode = 'P0001';
  end if;
  select handle into current_handle from app.profiles where id = p_profile_id for update;
  if exists (select 1 from app.profiles where lower(handle) = normalized_handle and id <> p_profile_id)
    or exists (select 1 from app.organizations where lower(handle) = normalized_handle) then
    raise exception 'namespace_unavailable' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from app.repositories mine
    join app.repositories other on lower(other.owner_handle) = normalized_handle and other.slug = mine.slug
    where mine.owner_profile_id = p_profile_id and other.owner_profile_id is distinct from p_profile_id
  ) then
    raise exception 'namespace_repository_conflict' using errcode = 'P0001';
  end if;
  update app.profiles set handle = normalized_handle where id = p_profile_id;
  update app.repositories set owner_handle = normalized_handle where owner_profile_id = p_profile_id;
  insert into app.namespace_claims (
    external_identity_id, profile_id, provider, provider_namespace, target_handle,
    namespace_kind, status, evidence, verified_at
  ) values (
    p_external_identity_id, p_profile_id, identity_row.provider,
    identity_row.provider_username, normalized_handle, 'personal', 'verified',
    jsonb_build_object('provider_subject', identity_row.provider_subject, 'previous_handle', current_handle),
    now()
  )
  on conflict (provider, lower(provider_namespace), namespace_kind)
    where status in ('pending', 'verified')
  do update set target_handle = excluded.target_handle, status = 'verified', verified_at = now(), updated_at = now()
  returning id into claim_id;
  insert into app.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    p_profile_id::text, 'bridge.namespace.claimed', 'profile', p_profile_id::text,
    jsonb_build_object('provider', identity_row.provider, 'provider_namespace', identity_row.provider_username, 'target_handle', normalized_handle)
  );
  return claim_id;
end;
$$;

create or replace function app.claim_bridge_organization(
  p_profile_id uuid,
  p_external_identity_id uuid,
  p_provider_org_id text,
  p_target_handle text,
  p_organization_type text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  identity_row app.external_identities;
  provider_organization jsonb;
  normalized_handle text := lower(trim(p_target_handle));
  provider_role text;
  provider_name text;
  provider_restrictions jsonb;
  organization_id uuid;
begin
  select * into identity_row from app.external_identities
  where id = p_external_identity_id and profile_id = p_profile_id and revoked_at is null
  for update;
  if identity_row.id is null or not ('read-memberships' = any(identity_row.scopes)) then
    raise exception 'organization_membership_authorization_required' using errcode = '42501';
  end if;
  select value into provider_organization
  from jsonb_array_elements(identity_row.organizations) value
  where value->>'sub' = p_provider_org_id
    and lower(coalesce(nullif(value->>'preferred_username', ''), value->>'name', '')) = normalized_handle
  limit 1;
  if provider_organization is null then
    raise exception 'organization_membership_not_verified' using errcode = '42501';
  end if;
  provider_role := lower(coalesce(
    provider_organization->>'role_in_org',
    provider_organization->>'roleInOrg',
    provider_organization->>'role',
    ''
  ));
  if provider_role <> 'admin' then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;
  provider_restrictions := coalesce(
    provider_organization->'security_restrictions',
    provider_organization->'securityRestrictions',
    '[]'::jsonb
  );
  if jsonb_typeof(provider_restrictions) <> 'array'
    or jsonb_array_length(provider_restrictions) > 0 then
    raise exception 'organization_security_requirements_incomplete' using errcode = '42501';
  end if;
  provider_name := left(coalesce(
    nullif(trim(provider_organization->>'name'), ''),
    normalized_handle
  ), 200);
  organization_id := app.create_organization(
    p_profile_id,
    normalized_handle,
    p_organization_type,
    provider_name,
    'https://huggingface.co/' || normalized_handle,
    case when coalesce(provider_organization->>'picture', '') ~ '^https://' then
      provider_organization->>'picture' else null end,
    null,
    null,
    null,
    '[]'::jsonb
  );
  insert into app.namespace_claims (
    external_identity_id, organization_id, provider, provider_namespace,
    target_handle, namespace_kind, provider_role, status, evidence, verified_at
  ) values (
    p_external_identity_id, organization_id, identity_row.provider,
    normalized_handle, normalized_handle, 'organization', provider_role,
    'verified',
    jsonb_build_object(
      'provider_subject', p_provider_org_id,
      'membership_scope', 'read-memberships',
      'role', provider_role
    ),
    now()
  );
  insert into app.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    p_profile_id::text,
    'bridge.organization.claimed',
    'organization',
    organization_id::text,
    jsonb_build_object(
      'provider', identity_row.provider,
      'provider_namespace', normalized_handle,
      'provider_role', provider_role
    )
  );
  return organization_id;
end;
$$;

drop trigger if exists external_identities_touch_updated_at on app.external_identities;
create trigger external_identities_touch_updated_at before update on app.external_identities
for each row execute function app.touch_updated_at();
drop trigger if exists namespace_claims_touch_updated_at on app.namespace_claims;
create trigger namespace_claims_touch_updated_at before update on app.namespace_claims
for each row execute function app.touch_updated_at();
drop trigger if exists bridge_import_jobs_touch_updated_at on app.bridge_import_jobs;
create trigger bridge_import_jobs_touch_updated_at before update on app.bridge_import_jobs
for each row execute function app.touch_updated_at();
drop trigger if exists bridge_import_items_touch_updated_at on app.bridge_import_items;
create trigger bridge_import_items_touch_updated_at before update on app.bridge_import_items
for each row execute function app.touch_updated_at();
drop trigger if exists bridge_sync_subscriptions_touch_updated_at on app.bridge_sync_subscriptions;
create trigger bridge_sync_subscriptions_touch_updated_at before update on app.bridge_sync_subscriptions
for each row execute function app.touch_updated_at();

alter table app.external_identities enable row level security;
alter table app.bridge_oauth_states enable row level security;
alter table app.namespace_claims enable row level security;
alter table app.bridge_import_jobs enable row level security;
alter table app.bridge_import_items enable row level security;
alter table app.repository_sources enable row level security;
alter table app.bridge_sync_subscriptions enable row level security;
alter table app.bridge_events enable row level security;

commit;
