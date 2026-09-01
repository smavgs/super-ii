begin;

create table if not exists app.agent_identities (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null unique references app.service_accounts(id) on delete cascade,
  organization_id uuid not null references app.organizations(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  framework text not null default 'other' check (framework ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  agent_card_url text check (agent_card_url is null or agent_card_url ~ '^https://'),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  is_public boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disabled')),
  verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agent_identities_handle_lower_idx
  on app.agent_identities (lower(handle));
create index if not exists agent_identities_organization_idx
  on app.agent_identities (organization_id, status, created_at desc);

create table if not exists app.agent_access_tokens (
  id uuid primary key default gen_random_uuid(),
  agent_identity_id uuid not null references app.agent_identities(id) on delete cascade,
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  token_prefix text not null check (token_prefix ~ '^sii_agent_[a-z0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 8
    and scopes <@ array[
      'repository:create',
      'repository:upload',
      'repository:commit',
      'repository:submit',
      'events:read',
      'receipts:read',
      'jobs:claim',
      'jobs:submit'
    ]::text[]
  ),
  repository_id uuid references app.repositories(id) on delete cascade,
  resource_group_id uuid references app.resource_groups(id) on delete cascade,
  max_actions integer not null default 500 check (max_actions between 1 and 10000),
  actions_used integer not null default 0 check (actions_used between 0 and max_actions),
  spend_limit_cents integer not null default 0 check (spend_limit_cents = 0),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_access_tokens_bounded_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  )
);
create index if not exists agent_access_tokens_active_idx
  on app.agent_access_tokens (token_hash, expires_at)
  where revoked_at is null;
create index if not exists agent_access_tokens_identity_idx
  on app.agent_access_tokens (agent_identity_id, created_at desc);

create table if not exists app.agent_action_receipts (
  sequence bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  agent_identity_id uuid not null references app.agent_identities(id) on delete restrict,
  token_id uuid references app.agent_access_tokens(id) on delete set null,
  operator_profile_id uuid not null references app.profiles(id) on delete restrict,
  operator_organization_id uuid not null references app.organizations(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  action text not null check (action in (
    'repository.create',
    'revision.create',
    'transfer.create',
    'revision.commit',
    'revision.submit',
    'job.claim',
    'job.submit'
  )),
  target_type text not null check (target_type in ('repository', 'revision', 'transfer', 'job', 'submission')),
  target_id uuid,
  target_ref text check (target_ref is null or char_length(target_ref) <= 500),
  requested_scopes text[] not null check (cardinality(requested_scopes) between 1 and 8),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('succeeded', 'rejected', 'failed')),
  review_boundary text not null default 'human-review-required'
    check (review_boundary in ('human-review-required', 'human-approved', 'not-applicable')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (agent_identity_id, idempotency_key),
  constraint agent_action_receipts_success_hash check (status <> 'succeeded' or result_sha256 is not null)
);
create index if not exists agent_action_receipts_identity_idx
  on app.agent_action_receipts (agent_identity_id, sequence desc);
create index if not exists agent_action_receipts_target_idx
  on app.agent_action_receipts (target_type, target_id, sequence desc);

create table if not exists app.agent_events (
  cursor bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  organization_id uuid references app.organizations(id) on delete cascade,
  repository_id uuid references app.repositories(id) on delete cascade,
  agent_identity_id uuid references app.agent_identities(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  visibility text not null default 'operator' check (visibility in ('public', 'operator')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists agent_events_organization_cursor_idx
  on app.agent_events (organization_id, cursor);
create index if not exists agent_events_repository_cursor_idx
  on app.agent_events (repository_id, cursor);
create index if not exists agent_events_agent_cursor_idx
  on app.agent_events (agent_identity_id, cursor);

create table if not exists app.agent_subscriptions (
  id uuid primary key default gen_random_uuid(),
  agent_identity_id uuid not null references app.agent_identities(id) on delete cascade,
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  target_type text not null default 'organization'
    check (target_type in ('organization', 'repository', 'agent')),
  target_id uuid not null,
  event_types text[] not null default '{}' check (cardinality(event_types) <= 24),
  delivery text not null default 'poll' check (delivery = 'poll'),
  acknowledged_cursor bigint not null default 0 check (acknowledged_cursor >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_identity_id, target_type, target_id)
);
create index if not exists agent_subscriptions_enabled_idx
  on app.agent_subscriptions (agent_identity_id, enabled, updated_at desc);

create table if not exists app.agent_contribution_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  organization_id uuid references app.organizations(id) on delete cascade,
  repository_id uuid references app.repositories(id) on delete cascade,
  job_type text not null check (job_type in (
    'metadata-enrichment',
    'compatibility-check',
    'dataset-validation',
    'documentation',
    'provenance'
  )),
  title text not null check (char_length(title) between 3 and 160),
  description text not null check (char_length(description) between 10 and 4000),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  input_sha256 text not null check (input_sha256 ~ '^[a-f0-9]{64}$'),
  reward_label text not null default 'community reputation' check (char_length(reward_label) between 1 and 120),
  status text not null default 'open'
    check (status in ('open', 'claimed', 'submitted', 'accepted', 'rejected', 'cancelled')),
  claimed_by_agent_id uuid references app.agent_identities(id) on delete set null,
  claimed_at timestamptz,
  review_required boolean not null default true check (review_required),
  deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_contribution_jobs_open_idx
  on app.agent_contribution_jobs (status, created_at desc);
create index if not exists agent_contribution_jobs_agent_idx
  on app.agent_contribution_jobs (claimed_by_agent_id, status, updated_at desc);

create table if not exists app.agent_contribution_submissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.agent_contribution_jobs(id) on delete cascade,
  agent_identity_id uuid not null references app.agent_identities(id) on delete restrict,
  receipt_id uuid not null references app.agent_action_receipts(id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_sha256 text not null check (result_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected')),
  reviewed_by_profile_id uuid references app.profiles(id) on delete restrict,
  review_notes text check (review_notes is null or char_length(review_notes) <= 4000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (job_id, agent_identity_id)
);
create index if not exists agent_contribution_submissions_agent_idx
  on app.agent_contribution_submissions (agent_identity_id, status, submitted_at desc);

create or replace function app.assert_agent_identity_operator()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if not exists (
    select 1
    from app.service_accounts account
    where account.id = new.service_account_id
      and account.organization_id = new.organization_id
      and account.disabled_at is null
  ) then
    raise exception 'agent_service_account_operator_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.create_agent_identity(
  p_profile_id uuid,
  p_organization_id uuid,
  p_handle text,
  p_display_name text,
  p_description text,
  p_framework text,
  p_agent_card_url text,
  p_is_public boolean
)
returns table(agent_identity_id uuid, service_account_id uuid)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  normalized_handle text := lower(trim(p_handle));
  new_service_account_id uuid;
  new_agent_identity_id uuid;
begin
  if not exists (
    select 1 from app.organization_members member
    where member.organization_id = p_organization_id
      and member.profile_id = p_profile_id
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'agent_operator_permission_denied' using errcode = '42501';
  end if;
  if normalized_handle !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
    or char_length(trim(p_display_name)) not between 1 and 120
    or char_length(coalesce(p_description, '')) > 2000
    or coalesce(p_framework, '') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or (p_agent_card_url is not null and p_agent_card_url !~ '^https://') then
    raise exception 'agent_identity_invalid' using errcode = '22023';
  end if;

  insert into app.service_accounts (
    organization_id, name, description, created_by_profile_id
  ) values (
    p_organization_id,
    'agent-' || normalized_handle,
    left('Service account for @' || normalized_handle || '. ' || coalesce(p_description, ''), 2000),
    p_profile_id
  ) returning id into new_service_account_id;

  insert into app.agent_identities (
    service_account_id, organization_id, handle, display_name, description,
    framework, agent_card_url, created_by_profile_id, is_public
  ) values (
    new_service_account_id, p_organization_id, normalized_handle,
    trim(p_display_name), coalesce(p_description, ''), p_framework,
    p_agent_card_url, p_profile_id, coalesce(p_is_public, false)
  ) returning id into new_agent_identity_id;

  return query select new_agent_identity_id, new_service_account_id;
end;
$$;

create or replace function app.consume_agent_access_token(
  p_token_hash text,
  p_scope text,
  p_repository_id uuid default null
)
returns table(
  token_id uuid,
  agent_identity_id uuid,
  operator_profile_id uuid,
  operator_organization_id uuid,
  granted_scopes text[],
  bound_repository_id uuid
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope not in (
      'repository:create', 'repository:upload', 'repository:commit',
      'repository:submit', 'events:read', 'receipts:read',
      'jobs:claim', 'jobs:submit'
    ) then
    return;
  end if;

  return query
  update app.agent_access_tokens token
  set actions_used = token.actions_used + 1,
      last_used_at = now()
  from app.agent_identities identity,
       app.service_accounts service_account,
       app.organization_members operator_member
  where token.token_hash = p_token_hash
    and identity.id = token.agent_identity_id
    and service_account.id = identity.service_account_id
    and operator_member.organization_id = identity.organization_id
    and operator_member.profile_id = token.created_by_profile_id
    and operator_member.role in ('owner', 'admin')
    and service_account.disabled_at is null
    and identity.status = 'active'
    and token.revoked_at is null
    and token.expires_at > now()
    and token.actions_used < token.max_actions
    and p_scope = any(token.scopes)
    and (token.repository_id is null or token.repository_id = p_repository_id)
    and (
      p_repository_id is null
      or exists (
        select 1 from app.repositories repository
        where repository.id = p_repository_id
          and repository.owner_organization_id = identity.organization_id
      )
    )
  returning
    token.id,
    identity.id,
    token.created_by_profile_id,
    identity.organization_id,
    token.scopes,
    token.repository_id;
end;
$$;

create or replace function app.agent_create_repository_with_receipt(
  p_agent_identity_id uuid,
  p_token_id uuid,
  p_operator_profile_id uuid,
  p_operator_organization_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_kind repository_kind,
  p_slug text,
  p_title text,
  p_summary text,
  p_license text,
  p_task text,
  p_library text,
  p_modality text,
  p_card_markdown text,
  p_provenance jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  existing app.agent_action_receipts;
  created_repository_id uuid;
  created_revision_id uuid;
  created_branch_id uuid;
  result_data jsonb;
  result_hash text;
  recorded app.agent_action_receipts;
begin
  select * into existing from app.agent_action_receipts
  where agent_identity_id = p_agent_identity_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'repository.create'
      or existing.request_sha256 <> p_request_sha256 then
      raise exception 'agent_idempotency_conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('result', existing.detail -> 'result', 'receipt', to_jsonb(existing), 'replayed', true);
  end if;
  if not exists (
    select 1 from app.agent_identities identity
    where identity.id = p_agent_identity_id
      and identity.organization_id = p_operator_organization_id
      and identity.status = 'active'
  ) then
    raise exception 'agent_operator_mismatch' using errcode = '42501';
  end if;

  select repository_id, revision_id, branch_id
  into created_repository_id, created_revision_id, created_branch_id
  from app.create_repository_with_revision(
    p_operator_profile_id, p_operator_organization_id, p_kind, p_slug,
    p_title, p_summary, p_license, p_task, p_library, p_modality,
    p_card_markdown, p_provenance
  );
  result_data := jsonb_build_object(
    'repository_id', created_repository_id,
    'revision_id', created_revision_id,
    'branch_id', created_branch_id
  );
  result_hash := encode(public.digest(convert_to(result_data::text, 'UTF8'), 'sha256'), 'hex');
  recorded := app.record_agent_action_receipt(
    p_agent_identity_id, p_token_id, p_operator_profile_id,
    p_operator_organization_id, p_idempotency_key, 'repository.create',
    'repository', created_repository_id, p_slug,
    array['repository:create']::text[], p_request_sha256, result_hash,
    'succeeded', 'human-review-required', jsonb_build_object('result', result_data)
  );
  return jsonb_build_object('result', result_data, 'receipt', to_jsonb(recorded), 'replayed', false);
end;
$$;

create or replace function app.agent_create_revision_with_receipt(
  p_agent_identity_id uuid,
  p_token_id uuid,
  p_operator_profile_id uuid,
  p_operator_organization_id uuid,
  p_repository_id uuid,
  p_branch_id uuid,
  p_message text,
  p_idempotency_key text,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  existing app.agent_action_receipts;
  created app.repository_revisions;
  result_data jsonb;
  result_hash text;
  recorded app.agent_action_receipts;
begin
  select * into existing from app.agent_action_receipts
  where agent_identity_id = p_agent_identity_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'revision.create'
      or existing.request_sha256 <> p_request_sha256 then
      raise exception 'agent_idempotency_conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('result', existing.detail -> 'result', 'receipt', to_jsonb(existing), 'replayed', true);
  end if;
  if not exists (
    select 1 from app.agent_identities identity
    join app.repositories repository
      on repository.id = p_repository_id
      and repository.owner_organization_id = identity.organization_id
    where identity.id = p_agent_identity_id
      and identity.organization_id = p_operator_organization_id
      and identity.status = 'active'
  ) then
    raise exception 'agent_repository_permission_denied' using errcode = '42501';
  end if;

  created := app.create_repository_commit(
    p_repository_id, p_branch_id, p_message, 'agent:' || p_agent_identity_id::text
  );
  result_data := jsonb_build_object(
    'repository_id', created.repository_id,
    'revision_id', created.id,
    'branch_id', created.branch_id,
    'sequence', created.sequence,
    'status', created.status
  );
  result_hash := encode(public.digest(convert_to(result_data::text, 'UTF8'), 'sha256'), 'hex');
  recorded := app.record_agent_action_receipt(
    p_agent_identity_id, p_token_id, p_operator_profile_id,
    p_operator_organization_id, p_idempotency_key, 'revision.create',
    'revision', created.id, p_repository_id::text,
    array['repository:commit']::text[], p_request_sha256, result_hash,
    'succeeded', 'human-review-required', jsonb_build_object('result', result_data)
  );
  return jsonb_build_object('result', result_data, 'receipt', to_jsonb(recorded), 'replayed', false);
end;
$$;

create or replace function app.record_agent_action_receipt(
  p_agent_identity_id uuid,
  p_token_id uuid,
  p_operator_profile_id uuid,
  p_operator_organization_id uuid,
  p_idempotency_key text,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_target_ref text,
  p_requested_scopes text[],
  p_request_sha256 text,
  p_result_sha256 text,
  p_status text,
  p_review_boundary text,
  p_detail jsonb
)
returns app.agent_action_receipts
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.agent_action_receipts;
  created app.agent_action_receipts;
begin
  select * into existing
  from app.agent_action_receipts
  where agent_identity_id = p_agent_identity_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> p_action
      or existing.request_sha256 <> p_request_sha256
      or existing.target_type <> p_target_type
      or existing.target_id is distinct from p_target_id then
      raise exception 'agent_idempotency_conflict' using errcode = '40001';
    end if;
    return existing;
  end if;

  if not exists (
    select 1
    from app.agent_identities identity
    join app.agent_access_tokens token
      on token.id = p_token_id
      and token.agent_identity_id = identity.id
      and token.created_by_profile_id = p_operator_profile_id
    join app.organization_members member
      on member.organization_id = identity.organization_id
      and member.profile_id = p_operator_profile_id
      and member.role in ('owner', 'admin')
    where identity.id = p_agent_identity_id
      and identity.organization_id = p_operator_organization_id
      and identity.status = 'active'
      and token.revoked_at is null
      and token.expires_at > now()
      and p_requested_scopes <@ token.scopes
  ) then
    raise exception 'agent_receipt_operator_mismatch' using errcode = '42501';
  end if;

  insert into app.agent_action_receipts (
    agent_identity_id, token_id, operator_profile_id, operator_organization_id,
    idempotency_key, action, target_type, target_id, target_ref,
    requested_scopes, request_sha256, result_sha256, status,
    review_boundary, detail
  ) values (
    p_agent_identity_id, p_token_id, p_operator_profile_id,
    p_operator_organization_id, p_idempotency_key, p_action,
    p_target_type, p_target_id, p_target_ref, p_requested_scopes,
    p_request_sha256, p_result_sha256, p_status,
    p_review_boundary, coalesce(p_detail, '{}'::jsonb)
  ) returning * into created;
  return created;
end;
$$;

create or replace function app.agent_receipt_event()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  insert into app.agent_events (
    organization_id, agent_identity_id, event_type, visibility, payload, occurred_at
  ) values (
    new.operator_organization_id,
    new.agent_identity_id,
    'receipt.' || replace(new.action, '.', '-'),
    'operator',
    jsonb_build_object(
      'receipt_id', new.id,
      'sequence', new.sequence,
      'action', new.action,
      'target_type', new.target_type,
      'target_id', new.target_id,
      'status', new.status,
      'review_boundary', new.review_boundary,
      'request_sha256', new.request_sha256,
      'result_sha256', new.result_sha256
    ),
    new.occurred_at
  );
  return new;
end;
$$;

create or replace function app.claim_agent_contribution_job(
  p_agent_identity_id uuid,
  p_job_id uuid
)
returns app.agent_contribution_jobs
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  claimed app.agent_contribution_jobs;
begin
  if not exists (
    select 1 from app.agent_identities
    where id = p_agent_identity_id and status = 'active'
  ) then
    raise exception 'agent_identity_inactive' using errcode = '42501';
  end if;

  update app.agent_contribution_jobs job
  set status = 'claimed', claimed_by_agent_id = p_agent_identity_id,
      claimed_at = now(), updated_at = now()
  where job.id = p_job_id
    and job.status = 'open'
    and (job.deadline_at is null or job.deadline_at > now())
  returning * into claimed;
  if claimed.id is null then
    raise exception 'agent_job_unavailable' using errcode = '40001';
  end if;
  return claimed;
end;
$$;

create or replace function app.submit_agent_contribution(
  p_agent_identity_id uuid,
  p_job_id uuid,
  p_receipt_id uuid,
  p_result jsonb,
  p_result_sha256 text
)
returns app.agent_contribution_submissions
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  submission app.agent_contribution_submissions;
begin
  if jsonb_typeof(p_result) <> 'object' or p_result_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'agent_submission_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from app.agent_contribution_jobs job
    join app.agent_action_receipts receipt on receipt.id = p_receipt_id
    where job.id = p_job_id
      and job.status = 'claimed'
      and job.claimed_by_agent_id = p_agent_identity_id
      and receipt.agent_identity_id = p_agent_identity_id
      and receipt.action = 'job.submit'
      and receipt.status = 'succeeded'
      and receipt.result_sha256 = p_result_sha256
  ) then
    raise exception 'agent_submission_receipt_mismatch' using errcode = '42501';
  end if;

  insert into app.agent_contribution_submissions (
    job_id, agent_identity_id, receipt_id, result, result_sha256
  ) values (
    p_job_id, p_agent_identity_id, p_receipt_id, p_result, p_result_sha256
  ) returning * into submission;

  update app.agent_contribution_jobs
  set status = 'submitted', updated_at = now()
  where id = p_job_id and claimed_by_agent_id = p_agent_identity_id;
  return submission;
end;
$$;

create or replace function app.claim_agent_contribution_job_with_receipt(
  p_agent_identity_id uuid,
  p_token_id uuid,
  p_operator_profile_id uuid,
  p_operator_organization_id uuid,
  p_job_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_result_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.agent_action_receipts;
  claimed app.agent_contribution_jobs;
  recorded app.agent_action_receipts;
begin
  select * into existing from app.agent_action_receipts
  where agent_identity_id = p_agent_identity_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'job.claim'
      or existing.target_type <> 'job'
      or existing.target_id is distinct from p_job_id
      or existing.request_sha256 <> p_request_sha256 then
      raise exception 'agent_idempotency_conflict' using errcode = '40001';
    end if;
    select * into claimed from app.agent_contribution_jobs where id = p_job_id;
    return jsonb_build_object('job', to_jsonb(claimed), 'receipt', to_jsonb(existing), 'replayed', true);
  end if;

  claimed := app.claim_agent_contribution_job(p_agent_identity_id, p_job_id);
  recorded := app.record_agent_action_receipt(
    p_agent_identity_id, p_token_id, p_operator_profile_id,
    p_operator_organization_id, p_idempotency_key, 'job.claim',
    'job', p_job_id, null, array['jobs:claim']::text[],
    p_request_sha256, p_result_sha256, 'succeeded',
    'human-review-required',
    jsonb_build_object('job_id', p_job_id, 'status', claimed.status)
  );
  return jsonb_build_object('job', to_jsonb(claimed), 'receipt', to_jsonb(recorded), 'replayed', false);
end;
$$;

create or replace function app.submit_agent_contribution_with_receipt(
  p_agent_identity_id uuid,
  p_token_id uuid,
  p_operator_profile_id uuid,
  p_operator_organization_id uuid,
  p_job_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_result jsonb,
  p_result_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.agent_action_receipts;
  recorded app.agent_action_receipts;
  submission app.agent_contribution_submissions;
begin
  select * into existing from app.agent_action_receipts
  where agent_identity_id = p_agent_identity_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'job.submit'
      or existing.target_type <> 'job'
      or existing.target_id is distinct from p_job_id
      or existing.request_sha256 <> p_request_sha256 then
      raise exception 'agent_idempotency_conflict' using errcode = '40001';
    end if;
    select * into submission from app.agent_contribution_submissions
    where job_id = p_job_id and agent_identity_id = p_agent_identity_id;
    return jsonb_build_object('submission', to_jsonb(submission), 'receipt', to_jsonb(existing), 'replayed', true);
  end if;

  recorded := app.record_agent_action_receipt(
    p_agent_identity_id, p_token_id, p_operator_profile_id,
    p_operator_organization_id, p_idempotency_key, 'job.submit',
    'job', p_job_id, null, array['jobs:submit']::text[],
    p_request_sha256, p_result_sha256, 'succeeded',
    'human-review-required',
    jsonb_build_object('job_id', p_job_id, 'result_sha256', p_result_sha256)
  );
  submission := app.submit_agent_contribution(
    p_agent_identity_id, p_job_id, recorded.id, p_result, p_result_sha256
  );
  return jsonb_build_object('submission', to_jsonb(submission), 'receipt', to_jsonb(recorded), 'replayed', false);
end;
$$;

create or replace function app.review_agent_contribution(
  p_profile_id uuid,
  p_job_id uuid,
  p_decision text,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_job app.agent_contribution_jobs;
  target_submission app.agent_contribution_submissions;
  accepted boolean;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'agent_review_decision_invalid' using errcode = '22023';
  end if;
  select * into target_job from app.agent_contribution_jobs
  where id = p_job_id and status = 'submitted'
  for update;
  if target_job.id is null then
    raise exception 'agent_job_not_reviewable' using errcode = 'P0002';
  end if;
  if target_job.created_by_profile_id <> p_profile_id
    and not exists (
      select 1 from app.organization_members member
      where member.organization_id = target_job.organization_id
        and member.profile_id = p_profile_id
        and member.role in ('owner', 'admin')
    ) then
    raise exception 'agent_job_review_permission_denied' using errcode = '42501';
  end if;

  update app.agent_contribution_submissions
  set status = p_decision,
      reviewed_by_profile_id = p_profile_id,
      review_notes = nullif(left(trim(coalesce(p_notes, '')), 4000), ''),
      reviewed_at = now()
  where job_id = p_job_id and status = 'submitted'
  returning * into target_submission;
  if target_submission.id is null then
    raise exception 'agent_submission_not_reviewable' using errcode = 'P0002';
  end if;

  accepted := p_decision = 'accepted';
  update app.agent_contribution_jobs
  set status = p_decision, updated_at = now()
  where id = p_job_id;

  insert into app.agent_events (
    organization_id, repository_id, agent_identity_id,
    event_type, visibility, payload
  ) values (
    target_job.organization_id, target_job.repository_id,
    target_submission.agent_identity_id,
    'contribution.' || p_decision,
    case when accepted then 'public' else 'operator' end,
    jsonb_build_object(
      'job_id', p_job_id,
      'submission_id', target_submission.id,
      'decision', p_decision
    )
  );
  return jsonb_build_object(
    'job_id', p_job_id,
    'submission_id', target_submission.id,
    'decision', p_decision
  );
end;
$$;

create or replace function app.prevent_agent_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  raise exception 'agent_ledger_is_immutable' using errcode = '55000';
end;
$$;

create or replace view app.agent_reputation as
select
  identity.id as agent_identity_id,
  identity.handle,
  count(distinct submission.id) filter (where submission.status = 'accepted')::integer as accepted_contributions,
  count(distinct submission.id) filter (where submission.status = 'rejected')::integer as rejected_contributions,
  count(distinct receipt.id) filter (where receipt.status = 'succeeded')::integer as successful_actions,
  count(distinct receipt.id) filter (where receipt.status in ('failed', 'rejected'))::integer as unsuccessful_actions,
  greatest(
    0,
    10 * count(distinct submission.id) filter (where submission.status = 'accepted')
      - 2 * count(distinct submission.id) filter (where submission.status = 'rejected')
  )::integer as reputation_score
from app.agent_identities identity
left join app.agent_contribution_submissions submission
  on submission.agent_identity_id = identity.id
left join app.agent_action_receipts receipt
  on receipt.agent_identity_id = identity.id
group by identity.id, identity.handle;

drop trigger if exists agent_identities_assert_operator on app.agent_identities;
create trigger agent_identities_assert_operator
before insert or update of service_account_id, organization_id on app.agent_identities
for each row execute function app.assert_agent_identity_operator();

drop trigger if exists agent_action_receipts_emit_event on app.agent_action_receipts;
create trigger agent_action_receipts_emit_event
after insert on app.agent_action_receipts
for each row execute function app.agent_receipt_event();

drop trigger if exists agent_action_receipts_immutable on app.agent_action_receipts;
create trigger agent_action_receipts_immutable
before update or delete on app.agent_action_receipts
for each row execute function app.prevent_agent_ledger_mutation();

drop trigger if exists agent_events_immutable on app.agent_events;
create trigger agent_events_immutable
before update or delete on app.agent_events
for each row execute function app.prevent_agent_ledger_mutation();

drop trigger if exists agent_identities_touch_updated_at on app.agent_identities;
create trigger agent_identities_touch_updated_at before update on app.agent_identities
for each row execute function app.touch_updated_at();
drop trigger if exists agent_subscriptions_touch_updated_at on app.agent_subscriptions;
create trigger agent_subscriptions_touch_updated_at before update on app.agent_subscriptions
for each row execute function app.touch_updated_at();
drop trigger if exists agent_contribution_jobs_touch_updated_at on app.agent_contribution_jobs;
create trigger agent_contribution_jobs_touch_updated_at before update on app.agent_contribution_jobs
for each row execute function app.touch_updated_at();

alter table app.agent_identities enable row level security;
alter table app.agent_access_tokens enable row level security;
alter table app.agent_action_receipts enable row level security;
alter table app.agent_events enable row level security;
alter table app.agent_subscriptions enable row level security;
alter table app.agent_contribution_jobs enable row level security;
alter table app.agent_contribution_submissions enable row level security;

drop policy if exists agent_identities_public_read on app.agent_identities;
create policy agent_identities_public_read on app.agent_identities
for select using (is_public and status = 'active');

drop policy if exists agent_events_public_read on app.agent_events;
create policy agent_events_public_read on app.agent_events
for select using (visibility = 'public');

drop policy if exists agent_contribution_jobs_public_read on app.agent_contribution_jobs;
create policy agent_contribution_jobs_public_read on app.agent_contribution_jobs
for select using (status in ('open', 'claimed', 'submitted', 'accepted', 'rejected'));

drop policy if exists agent_contribution_submissions_public_read on app.agent_contribution_submissions;
create policy agent_contribution_submissions_public_read on app.agent_contribution_submissions
for select using (status = 'accepted');

commit;
