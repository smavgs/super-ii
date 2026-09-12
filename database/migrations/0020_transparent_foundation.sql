begin;

create table if not exists app.transparency_reports (
  id uuid primary key default gen_random_uuid(),
  report_key text not null unique check (report_key ~ '^[a-f0-9]{64}$'),
  provider text not null default 'huggingface' check (provider = 'huggingface'),
  repository_kind text not null check (repository_kind in ('model', 'dataset', 'space')),
  repository_id text not null check (repository_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'),
  repository_owner text not null check (char_length(repository_owner) between 1 and 255),
  source_revision text not null check (source_revision ~ '^[a-f0-9]{40,64}$'),
  requested_revision text not null check (char_length(requested_revision) between 1 and 200),
  criteria_version text not null check (criteria_version ~ '^hf-public-v[0-9]+\.[0-9]+$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (snapshot->>'report_key' = report_key),
  check (snapshot->>'provider' = provider),
  check (snapshot->>'criteria_version' = criteria_version),
  check (snapshot->'repository'->>'resolved_revision' = source_revision)
);
create unique index if not exists transparency_reports_revision_idx
  on app.transparency_reports (provider, repository_kind, lower(repository_id), source_revision, criteria_version);
create index if not exists transparency_reports_recent_idx on app.transparency_reports (checked_at desc);
create index if not exists transparency_reports_repository_idx
  on app.transparency_reports (provider, repository_kind, lower(repository_id), checked_at desc);

create table if not exists app.transparency_report_saves (
  report_id uuid not null references app.transparency_reports(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, profile_id)
);
create index if not exists transparency_report_saves_profile_idx
  on app.transparency_report_saves (profile_id, created_at desc);

create table if not exists app.transparency_report_watches (
  report_id uuid not null references app.transparency_reports(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  enabled boolean not null default true,
  last_seen_revision text not null check (last_seen_revision ~ '^[a-f0-9]{40,64}$'),
  latest_report_id uuid references app.transparency_reports(id) on delete restrict,
  latest_revision text check (latest_revision is null or latest_revision ~ '^[a-f0-9]{40,64}$'),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (report_id, profile_id)
);
create index if not exists transparency_report_watches_profile_idx
  on app.transparency_report_watches (profile_id, enabled, updated_at desc);

create table if not exists app.transparency_repository_claims (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'huggingface' check (provider = 'huggingface'),
  repository_kind text not null check (repository_kind in ('model', 'dataset', 'space')),
  repository_id text not null check (repository_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'),
  repository_owner text not null check (char_length(repository_owner) between 1 and 255),
  profile_id uuid not null references app.profiles(id) on delete restrict,
  external_identity_id uuid not null references app.external_identities(id) on delete restrict,
  verification_method text not null check (verification_method = 'huggingface-oauth-owner-match'),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists transparency_repository_claims_repository_idx
  on app.transparency_repository_claims (provider, repository_kind, lower(repository_id));
create index if not exists transparency_repository_claims_profile_idx
  on app.transparency_repository_claims (profile_id, verified_at desc);

create table if not exists app.transparency_creator_responses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references app.transparency_reports(id) on delete restrict,
  repository_claim_id uuid not null references app.transparency_repository_claims(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  response_type text not null check (response_type in ('response', 'correction')),
  body text not null check (char_length(body) between 10 and 4000),
  evidence_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_urls) = 'array' and jsonb_array_length(evidence_urls) <= 10),
  created_at timestamptz not null default now()
);
create index if not exists transparency_creator_responses_report_idx
  on app.transparency_creator_responses (report_id, created_at);

create table if not exists app.transparency_evidence_submissions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references app.transparency_reports(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  criterion_id text not null check (criterion_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  note text not null check (char_length(note) between 10 and 2000),
  source_url text not null check (source_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by_profile_id uuid references app.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists transparency_evidence_submissions_review_idx
  on app.transparency_evidence_submissions (status, created_at);
create index if not exists transparency_evidence_submissions_profile_idx
  on app.transparency_evidence_submissions (profile_id, created_at desc);

create table if not exists app.transparency_discovery_daily (
  day date not null default current_date,
  channel text not null check (channel in ('web', 'rest', 'mcp')),
  action text not null check (action in ('check', 'read', 'search', 'compare', 'watch')),
  resource_key text not null check (char_length(resource_key) between 1 and 511),
  events bigint not null default 0 check (events >= 0),
  primary key (day, channel, action, resource_key)
);

create or replace function app.reject_transparency_immutable_mutation()
returns trigger language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  raise exception 'transparency_evidence_is_immutable' using errcode = '55000';
end $$;

drop trigger if exists transparency_reports_immutable on app.transparency_reports;
create trigger transparency_reports_immutable before update or delete on app.transparency_reports
for each row execute function app.reject_transparency_immutable_mutation();
drop trigger if exists transparency_creator_responses_immutable on app.transparency_creator_responses;
create trigger transparency_creator_responses_immutable before update or delete on app.transparency_creator_responses
for each row execute function app.reject_transparency_immutable_mutation();

create or replace function app.record_transparency_discovery(
  p_channel text, p_action text, p_resource_key text
) returns void language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if p_channel not in ('web', 'rest', 'mcp')
    or p_action not in ('check', 'read', 'search', 'compare', 'watch')
    or char_length(p_resource_key) not between 1 and 511 then
    return;
  end if;
  insert into app.transparency_discovery_daily (day, channel, action, resource_key, events)
  values (current_date, p_channel, p_action, p_resource_key, 1)
  on conflict (day, channel, action, resource_key)
  do update set events = app.transparency_discovery_daily.events + 1;
end $$;

create or replace function app.advance_transparency_watches(p_report_id uuid)
returns integer language plpgsql security invoker set search_path = app, pg_catalog as $$
declare
  incoming app.transparency_reports;
  changed integer := 0;
begin
  select * into incoming from app.transparency_reports where id = p_report_id;
  if incoming.id is null then return 0; end if;

  with advanced as (
    update app.transparency_report_watches watch
    set latest_report_id = incoming.id,
        latest_revision = incoming.source_revision,
        last_checked_at = now(),
        updated_at = now()
    from app.transparency_reports original
    where original.id = watch.report_id
      and watch.enabled
      and original.provider = incoming.provider
      and original.repository_kind = incoming.repository_kind
      and lower(original.repository_id) = lower(incoming.repository_id)
      and original.source_revision <> incoming.source_revision
      and (watch.latest_report_id is null or coalesce(
        (select candidate.checked_at from app.transparency_reports candidate where candidate.id = watch.latest_report_id),
        original.checked_at
      ) < incoming.checked_at)
    returning watch.profile_id
  )
  insert into app.notifications (profile_id, event_type, title, body, href, metadata)
  select profile_id, 'transparency.new_revision', 'New transparency revision',
         incoming.repository_id || ' has a newly checked revision.',
         '/transparent/' || incoming.report_key,
         jsonb_build_object('report_key', incoming.report_key, 'revision', incoming.source_revision)
  from advanced;

  get diagnostics changed = row_count;
  return changed;
end $$;

alter table app.agent_access_tokens drop constraint if exists agent_access_tokens_scopes_check;
alter table app.agent_access_tokens add constraint agent_access_tokens_scopes_check check (
  cardinality(scopes) between 1 and 14 and scopes <@ array[
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','transparent:read','transparent:watch',
    'events:read','receipts:read','jobs:claim','jobs:submit']::text[]
);

create or replace function app.consume_agent_access_token(p_token_hash text, p_scope text, p_repository_id uuid default null)
returns table(token_id uuid, agent_identity_id uuid, operator_profile_id uuid, operator_organization_id uuid, granted_scopes text[], bound_repository_id uuid)
language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_scope not in (
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','transparent:read','transparent:watch',
    'events:read','receipts:read','jobs:claim','jobs:submit'
  ) then return; end if;
  return query update app.agent_access_tokens token
  set actions_used = token.actions_used + 1, last_used_at = now()
  from app.agent_identities identity, app.service_accounts service_account, app.organization_members operator_member
  where token.token_hash = p_token_hash and identity.id = token.agent_identity_id
    and service_account.id = identity.service_account_id and operator_member.organization_id = identity.organization_id
    and operator_member.profile_id = token.created_by_profile_id and operator_member.role in ('owner','admin')
    and service_account.disabled_at is null and identity.status = 'active' and token.revoked_at is null
    and token.expires_at > now() and token.actions_used < token.max_actions and p_scope = any(token.scopes)
    and (token.repository_id is null or token.repository_id = p_repository_id)
    and (p_repository_id is null or exists (select 1 from app.repositories repository where repository.id = p_repository_id and repository.owner_organization_id = identity.organization_id))
  returning token.id, identity.id, token.created_by_profile_id, identity.organization_id, token.scopes, token.repository_id;
end $$;

alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_action_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_action_check check (action in (
  'repository.create','revision.create','transfer.create','revision.commit','revision.submit','job.claim','job.submit',
  'robot.create','robot.version.create','transparency.watch'
));
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_target_type_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_target_type_check check (
  target_type in ('repository','revision','transfer','job','submission','robot','robot_version','transparency_report')
);

alter table app.transparency_reports enable row level security;
alter table app.transparency_report_saves enable row level security;
alter table app.transparency_report_watches enable row level security;
alter table app.transparency_repository_claims enable row level security;
alter table app.transparency_creator_responses enable row level security;
alter table app.transparency_evidence_submissions enable row level security;
alter table app.transparency_discovery_daily enable row level security;

drop policy if exists transparency_reports_public_read on app.transparency_reports;
create policy transparency_reports_public_read on app.transparency_reports for select using (true);
drop policy if exists transparency_claims_public_read on app.transparency_repository_claims;
create policy transparency_claims_public_read on app.transparency_repository_claims for select using (true);
drop policy if exists transparency_creator_responses_public_read on app.transparency_creator_responses;
create policy transparency_creator_responses_public_read on app.transparency_creator_responses for select using (true);

commit;
