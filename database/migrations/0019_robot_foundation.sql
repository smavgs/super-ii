begin;

create table if not exists app.robots (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references app.profiles(id) on delete cascade,
  owner_organization_id uuid references app.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$'),
  title text not null check (char_length(title) between 2 and 160),
  summary text not null check (char_length(summary) between 10 and 2000),
  audience text not null check (char_length(audience) between 1 and 160),
  visibility text not null default 'public' check (visibility in ('public','private')),
  status text not null default 'published' check (status in ('draft','published','archived')),
  latest_version_id uuid,
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint robots_exactly_one_owner check ((owner_profile_id is null) <> (owner_organization_id is null))
);
create unique index if not exists robots_profile_slug_idx on app.robots (owner_profile_id, lower(slug)) where owner_profile_id is not null;
create unique index if not exists robots_organization_slug_idx on app.robots (owner_organization_id, lower(slug)) where owner_organization_id is not null;
create index if not exists robots_public_idx on app.robots (updated_at desc, id) where visibility = 'public' and status = 'published';

create table if not exists app.robot_versions (
  id uuid primary key default gen_random_uuid(),
  robot_id uuid not null references app.robots(id) on delete cascade,
  version_number integer not null check (version_number between 1 and 1000000),
  planner_input jsonb not null check (jsonb_typeof(planner_input) = 'object' and octet_length(planner_input::text) <= 16384),
  plan_snapshot jsonb not null check (jsonb_typeof(plan_snapshot) = 'object' and octet_length(plan_snapshot::text) <= 262144),
  catalog_revision text not null check (char_length(catalog_revision) between 1 and 40),
  change_summary text not null check (char_length(change_summary) between 1 and 1000),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  created_by_agent_id uuid references app.agent_identities(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (robot_id, version_number)
);
create index if not exists robot_versions_robot_idx on app.robot_versions (robot_id, version_number desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'robots_latest_version_fk' and conrelid = 'app.robots'::regclass) then
    alter table app.robots add constraint robots_latest_version_fk foreign key (latest_version_id) references app.robot_versions(id) on delete restrict;
  end if;
end $$;

create table if not exists app.robot_hardware (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references app.profiles(id) on delete cascade,
  owner_organization_id uuid references app.organizations(id) on delete cascade,
  component_slug text check (component_slug is null or component_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  custom_name text check (custom_name is null or char_length(custom_name) between 1 and 160),
  quantity integer not null default 1 check (quantity between 1 and 10000),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'available' check (status in ('available','in-use','repair','retired')),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint robot_hardware_exactly_one_owner check ((owner_profile_id is null) <> (owner_organization_id is null)),
  constraint robot_hardware_named check ((component_slug is null) <> (custom_name is null))
);
create index if not exists robot_hardware_profile_idx on app.robot_hardware (owner_profile_id, updated_at desc) where archived_at is null;
create index if not exists robot_hardware_organization_idx on app.robot_hardware (owner_organization_id, updated_at desc) where archived_at is null;

create table if not exists app.robot_component_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  component_slug text not null check (component_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  proposed_changes jsonb not null check (jsonb_typeof(proposed_changes) = 'object' and octet_length(proposed_changes::text) <= 65536),
  source_urls jsonb not null check (jsonb_typeof(source_urls) = 'array' and jsonb_array_length(source_urls) between 1 and 20 and octet_length(source_urls::text) <= 42000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  submitted_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  reviewed_by_profile_id uuid references app.profiles(id) on delete restrict,
  review_notes text check (review_notes is null or char_length(review_notes) <= 4000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists robot_component_claims_component_idx on app.robot_component_claims (component_slug, status, updated_at desc);
create unique index if not exists robot_component_claims_one_pending_idx on app.robot_component_claims (organization_id, component_slug) where status = 'pending';

create table if not exists app.robot_discovery_daily (
  day date not null default current_date,
  channel text not null check (channel in ('web','rest','mcp','a2a')),
  resource_type text not null check (resource_type in ('component','robot','catalog','planner')),
  resource_key text not null check (char_length(resource_key) between 1 and 200),
  events bigint not null default 0 check (events >= 0),
  primary key (day, channel, resource_type, resource_key)
);

create or replace function app.profile_robot_plan_rank(p_profile_id uuid)
returns integer language sql stable security invoker set search_path = app, pg_catalog as $$
  select coalesce(max(case subscription.plan_id when 'enterprise' then 3 when 'team' then 2 when 'pro' then 1 else 0 end), 0)
  from app.profiles profile
  left join app.organization_members member on member.profile_id = profile.id
  left join app.organizations organization on organization.id = member.organization_id
  left join app.subscriptions subscription on subscription.status = 'active'
    and (subscription.current_period_end is null or subscription.current_period_end > now())
    and (
      subscription.clerk_user_id = profile.clerk_user_id
      or subscription.organization_id = organization.id
      or (subscription.clerk_organization_id is not null and subscription.clerk_organization_id = organization.clerk_organization_id)
    )
  where profile.id = p_profile_id
$$;

create or replace function app.organization_robot_plan_rank(p_profile_id uuid, p_organization_id uuid)
returns integer language sql stable security invoker set search_path = app, pg_catalog as $$
  select coalesce(max(case subscription.plan_id when 'enterprise' then 3 when 'team' then 2 else 0 end), 0)
  from app.organization_members member
  join app.organizations organization on organization.id = member.organization_id
  join app.subscriptions subscription on subscription.status = 'active'
    and (subscription.current_period_end is null or subscription.current_period_end > now())
    and (subscription.organization_id = organization.id or subscription.clerk_organization_id = organization.clerk_organization_id)
  where member.profile_id = p_profile_id and member.organization_id = p_organization_id
    and member.role in ('owner','admin','maintainer')
$$;

create or replace function app.create_robot_with_version(
  p_profile_id uuid, p_organization_id uuid, p_slug text, p_title text, p_summary text,
  p_audience text, p_visibility text, p_planner_input jsonb, p_plan_snapshot jsonb,
  p_catalog_revision text, p_change_summary text, p_agent_id uuid default null
)
returns table(robot_id uuid, version_id uuid, owner_handle text, version_number integer)
language plpgsql security invoker set search_path = app, pg_catalog as $$
declare new_robot_id uuid; new_version_id uuid; resolved_owner_handle text;
begin
  if p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$'
    or char_length(btrim(p_title)) not between 2 and 160
    or char_length(btrim(p_summary)) not between 10 and 2000
    or char_length(btrim(p_audience)) not between 1 and 160
    or p_visibility not in ('public','private')
    or jsonb_typeof(p_planner_input) <> 'object' or jsonb_typeof(p_plan_snapshot) <> 'object' then
    raise exception 'robot_input_invalid' using errcode = '22023';
  end if;
  if p_organization_id is null then
    select handle into resolved_owner_handle from app.profiles where id = p_profile_id;
    if resolved_owner_handle is null then raise exception 'robot_owner_not_found' using errcode = 'P0002'; end if;
    if p_visibility = 'private' and app.profile_robot_plan_rank(p_profile_id) < 1 then
      raise exception 'robot_private_requires_pro' using errcode = '42501';
    end if;
  else
    select handle into resolved_owner_handle from app.organizations where id = p_organization_id;
    if resolved_owner_handle is null or app.organization_robot_plan_rank(p_profile_id, p_organization_id) < 2 then
      raise exception 'robot_team_owner_requires_team' using errcode = '42501';
    end if;
  end if;
  if p_agent_id is not null and not exists (
    select 1 from app.agent_identities identity where identity.id = p_agent_id
      and identity.organization_id = p_organization_id and identity.status = 'active'
  ) then raise exception 'robot_agent_owner_mismatch' using errcode = '42501'; end if;

  insert into app.robots (owner_profile_id, owner_organization_id, slug, title, summary, audience, visibility, status, created_by_profile_id)
  values (case when p_organization_id is null then p_profile_id end, p_organization_id, p_slug, btrim(p_title), btrim(p_summary), btrim(p_audience), p_visibility, 'published', p_profile_id)
  returning id into new_robot_id;
  insert into app.robot_versions (robot_id, version_number, planner_input, plan_snapshot, catalog_revision, change_summary, created_by_profile_id, created_by_agent_id)
  values (new_robot_id, 1, p_planner_input, p_plan_snapshot, p_catalog_revision, btrim(p_change_summary), p_profile_id, p_agent_id)
  returning id into new_version_id;
  update app.robots set latest_version_id = new_version_id where id = new_robot_id;
  return query select new_robot_id, new_version_id, resolved_owner_handle, 1;
end $$;

create or replace function app.create_robot_version(
  p_profile_id uuid, p_robot_id uuid, p_planner_input jsonb, p_plan_snapshot jsonb,
  p_catalog_revision text, p_change_summary text, p_agent_id uuid default null
)
returns table(version_id uuid, version_number integer)
language plpgsql security invoker set search_path = app, pg_catalog as $$
declare target app.robots; next_number integer; created_version uuid;
begin
  select * into target from app.robots where id = p_robot_id for update;
  if target.id is null then raise exception 'robot_not_found' using errcode = 'P0002'; end if;
  if not (
    target.owner_profile_id = p_profile_id
    or exists (select 1 from app.organization_members member where member.organization_id = target.owner_organization_id and member.profile_id = p_profile_id and member.role in ('owner','admin','maintainer'))
  ) then raise exception 'robot_permission_denied' using errcode = '42501'; end if;
  if target.owner_organization_id is not null and app.organization_robot_plan_rank(p_profile_id, target.owner_organization_id) < 2 then
    raise exception 'robot_team_owner_requires_team' using errcode = '42501';
  end if;
  if target.owner_profile_id is not null and target.visibility = 'private' and app.profile_robot_plan_rank(p_profile_id) < 1 then
    raise exception 'robot_private_requires_pro' using errcode = '42501';
  end if;
  if p_agent_id is not null and not exists (select 1 from app.agent_identities identity where identity.id = p_agent_id and identity.organization_id = target.owner_organization_id and identity.status = 'active') then
    raise exception 'robot_agent_owner_mismatch' using errcode = '42501';
  end if;
  select coalesce(max(item.version_number), 0) + 1 into next_number from app.robot_versions item where item.robot_id = p_robot_id;
  insert into app.robot_versions (robot_id, version_number, planner_input, plan_snapshot, catalog_revision, change_summary, created_by_profile_id, created_by_agent_id)
  values (p_robot_id, next_number, p_planner_input, p_plan_snapshot, p_catalog_revision, btrim(p_change_summary), p_profile_id, p_agent_id)
  returning id into created_version;
  update app.robots set latest_version_id = created_version, updated_at = now() where id = p_robot_id;
  return query select created_version, next_number;
end $$;

create or replace function app.reject_robot_version_mutation()
returns trigger language plpgsql security invoker set search_path = app, pg_catalog as $$
begin raise exception 'robot_versions_are_immutable' using errcode = '55000'; end $$;
drop trigger if exists robot_versions_immutable on app.robot_versions;
create trigger robot_versions_immutable before update or delete on app.robot_versions for each row execute function app.reject_robot_version_mutation();

create or replace function app.record_robot_discovery(p_channel text, p_resource_type text, p_resource_key text)
returns void language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if p_channel not in ('web','rest','mcp','a2a') or p_resource_type not in ('component','robot','catalog','planner') or char_length(p_resource_key) not between 1 and 200 then return; end if;
  insert into app.robot_discovery_daily (day, channel, resource_type, resource_key, events)
  values (current_date, p_channel, p_resource_type, p_resource_key, 1)
  on conflict (day, channel, resource_type, resource_key) do update set events = app.robot_discovery_daily.events + 1;
end $$;

alter table app.agent_access_tokens drop constraint if exists agent_access_tokens_scopes_check;
alter table app.agent_access_tokens add constraint agent_access_tokens_scopes_check check (
  cardinality(scopes) between 1 and 12 and scopes <@ array[
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','events:read','receipts:read','jobs:claim','jobs:submit']::text[]
);

create or replace function app.consume_agent_access_token(p_token_hash text, p_scope text, p_repository_id uuid default null)
returns table(token_id uuid, agent_identity_id uuid, operator_profile_id uuid, operator_organization_id uuid, granted_scopes text[], bound_repository_id uuid)
language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_scope not in (
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','events:read','receipts:read','jobs:claim','jobs:submit'
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
  'repository.create','revision.create','transfer.create','revision.commit','revision.submit','job.claim','job.submit','robot.create','robot.version.create'
));
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_target_type_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_target_type_check check (target_type in ('repository','revision','transfer','job','submission','robot','robot_version'));
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_requested_scopes_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_requested_scopes_check check (cardinality(requested_scopes) between 1 and 12);

create or replace function app.agent_create_robot_with_receipt(
  p_agent_identity_id uuid, p_token_id uuid, p_operator_profile_id uuid, p_operator_organization_id uuid,
  p_idempotency_key text, p_request_sha256 text, p_slug text, p_title text, p_summary text,
  p_audience text, p_visibility text, p_planner_input jsonb, p_plan_snapshot jsonb,
  p_catalog_revision text, p_change_summary text
) returns jsonb language plpgsql security invoker set search_path = app, pg_catalog, public as $$
declare existing app.agent_action_receipts; created record; result_data jsonb; result_hash text; recorded app.agent_action_receipts;
begin
  select * into existing from app.agent_action_receipts where agent_identity_id = p_agent_identity_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'robot.create' or existing.request_sha256 <> p_request_sha256 then raise exception 'agent_idempotency_conflict' using errcode = '40001'; end if;
    return jsonb_build_object('result', existing.detail -> 'result', 'receipt', to_jsonb(existing), 'replayed', true);
  end if;
  select * into created from app.create_robot_with_version(p_operator_profile_id, p_operator_organization_id, p_slug, p_title, p_summary, p_audience, p_visibility, p_planner_input, p_plan_snapshot, p_catalog_revision, p_change_summary, p_agent_identity_id);
  result_data := jsonb_build_object('robot_id', created.robot_id, 'version_id', created.version_id, 'owner_handle', created.owner_handle, 'version_number', created.version_number);
  result_hash := encode(public.digest(convert_to(result_data::text, 'UTF8'), 'sha256'), 'hex');
  recorded := app.record_agent_action_receipt(p_agent_identity_id, p_token_id, p_operator_profile_id, p_operator_organization_id, p_idempotency_key, 'robot.create', 'robot', created.robot_id, created.owner_handle || '/' || p_slug, array['robot:create']::text[], p_request_sha256, result_hash, 'succeeded', 'not-applicable', jsonb_build_object('result', result_data));
  return jsonb_build_object('result', result_data, 'receipt', to_jsonb(recorded), 'replayed', false);
end $$;

create or replace function app.agent_create_robot_version_with_receipt(
  p_agent_identity_id uuid, p_token_id uuid, p_operator_profile_id uuid, p_operator_organization_id uuid,
  p_idempotency_key text, p_request_sha256 text, p_robot_id uuid, p_planner_input jsonb,
  p_plan_snapshot jsonb, p_catalog_revision text, p_change_summary text
) returns jsonb language plpgsql security invoker set search_path = app, pg_catalog, public as $$
declare existing app.agent_action_receipts; created record; result_data jsonb; result_hash text; recorded app.agent_action_receipts;
begin
  select * into existing from app.agent_action_receipts where agent_identity_id = p_agent_identity_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'robot.version.create' or existing.request_sha256 <> p_request_sha256 then raise exception 'agent_idempotency_conflict' using errcode = '40001'; end if;
    return jsonb_build_object('result', existing.detail -> 'result', 'receipt', to_jsonb(existing), 'replayed', true);
  end if;
  if not exists (select 1 from app.robots robot where robot.id = p_robot_id and robot.owner_organization_id = p_operator_organization_id) then raise exception 'robot_agent_owner_mismatch' using errcode = '42501'; end if;
  select * into created from app.create_robot_version(p_operator_profile_id, p_robot_id, p_planner_input, p_plan_snapshot, p_catalog_revision, p_change_summary, p_agent_identity_id);
  result_data := jsonb_build_object('robot_id', p_robot_id, 'version_id', created.version_id, 'version_number', created.version_number);
  result_hash := encode(public.digest(convert_to(result_data::text, 'UTF8'), 'sha256'), 'hex');
  recorded := app.record_agent_action_receipt(p_agent_identity_id, p_token_id, p_operator_profile_id, p_operator_organization_id, p_idempotency_key, 'robot.version.create', 'robot_version', created.version_id, p_robot_id::text, array['robot:update']::text[], p_request_sha256, result_hash, 'succeeded', 'not-applicable', jsonb_build_object('result', result_data));
  return jsonb_build_object('result', result_data, 'receipt', to_jsonb(recorded), 'replayed', false);
end $$;

alter table app.robots enable row level security;
alter table app.robot_versions enable row level security;
alter table app.robot_hardware enable row level security;
alter table app.robot_component_claims enable row level security;
alter table app.robot_discovery_daily enable row level security;
drop policy if exists robots_public_read on app.robots;
create policy robots_public_read on app.robots for select using (visibility = 'public' and status = 'published');
drop policy if exists robot_versions_public_read on app.robot_versions;
create policy robot_versions_public_read on app.robot_versions for select using (exists (select 1 from app.robots robot where robot.id = robot_versions.robot_id and robot.visibility = 'public' and robot.status = 'published'));

commit;
