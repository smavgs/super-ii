begin;

create table if not exists app.repository_compatibility (
  revision_id uuid primary key,
  repository_id uuid not null,
  architecture text,
  parameter_count bigint check (parameter_count is null or parameter_count >= 0),
  quantization text,
  tensor_format text,
  model_size_bytes bigint not null default 0 check (model_size_bytes >= 0),
  minimum_ram_bytes bigint not null default 0 check (minimum_ram_bytes >= 0),
  minimum_vram_bytes bigint not null default 0 check (minimum_vram_bytes >= 0),
  cpu_compatible boolean,
  cuda_compatible boolean,
  rocm_compatible boolean,
  metal_compatible boolean,
  mlx_compatible boolean,
  llama_cpp_compatible boolean,
  browser_compatible boolean,
  confidence text not null default 'derived' check (confidence in ('declared', 'derived', 'verified')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id) on delete cascade
);
create index if not exists repository_compatibility_discovery_idx
  on app.repository_compatibility (
    minimum_ram_bytes,
    minimum_vram_bytes,
    cpu_compatible,
    cuda_compatible,
    rocm_compatible,
    metal_compatible,
    mlx_compatible,
    llama_cpp_compatible,
    browser_compatible
  );

create table if not exists app.resource_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$'),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists app.resource_group_repositories (
  resource_group_id uuid not null references app.resource_groups(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (resource_group_id, repository_id)
);

create table if not exists app.resource_group_members (
  resource_group_id uuid not null references app.resource_groups(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'maintainer', 'reviewer', 'publisher', 'reader')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_group_id, profile_id)
);

create table if not exists app.service_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists app.service_account_roles (
  service_account_id uuid not null references app.service_accounts(id) on delete cascade,
  resource_group_id uuid not null references app.resource_groups(id) on delete cascade,
  role text not null check (role in ('maintainer', 'reviewer', 'publisher', 'reader')),
  created_at timestamptz not null default now(),
  primary key (service_account_id, resource_group_id)
);

create table if not exists app.trusted_publishers (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  provider text not null check (provider in ('github-actions', 'gitlab-ci', 'cloudflare')),
  issuer text not null check (issuer ~ '^https://'),
  subject text not null check (char_length(subject) between 3 and 500),
  audience text not null check (char_length(audience) between 3 and 500),
  workflow_ref text check (workflow_ref is null or char_length(workflow_ref) between 3 and 1000),
  allowed_scopes jsonb not null default '["repository:upload","repository:commit","repository:submit"]'::jsonb
    check (jsonb_typeof(allowed_scopes) = 'array'),
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  enabled boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, provider, issuer, subject, audience)
);
alter table app.trusted_publishers
  add column if not exists allowed_scopes jsonb not null
  default '["repository:upload","repository:commit","repository:submit"]'::jsonb;
create index if not exists trusted_publishers_repository_enabled_idx
  on app.trusted_publishers (repository_id, enabled);

create table if not exists app.scoped_access_tokens (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  service_account_id uuid references app.service_accounts(id) on delete cascade,
  trusted_publisher_id uuid references app.trusted_publishers(id) on delete cascade,
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  token_prefix text not null check (token_prefix ~ '^sii_[a-z0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes jsonb not null check (jsonb_typeof(scopes) = 'array'),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scoped_access_tokens_single_owner check (
    ((service_account_id is not null)::integer + (trusted_publisher_id is not null)::integer) = 1
  ),
  constraint scoped_access_tokens_future_expiry check (expires_at > created_at)
);
create index if not exists scoped_access_tokens_active_idx
  on app.scoped_access_tokens (token_hash, expires_at)
  where revoked_at is null;

create table if not exists app.agent_traces (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid references app.repository_revisions(id) on delete set null,
  actor_profile_id uuid references app.profiles(id) on delete set null,
  service_account_id uuid references app.service_accounts(id) on delete set null,
  trusted_publisher_id uuid references app.trusted_publishers(id) on delete set null,
  trace_id text not null check (char_length(trace_id) between 8 and 200),
  agent_name text not null check (char_length(agent_name) between 1 and 200),
  tool_name text check (tool_name is null or char_length(tool_name) between 1 and 200),
  status text not null check (status in ('succeeded', 'failed', 'cancelled')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[a-f0-9]{64}$'),
  output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_public boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (repository_id, trace_id)
);
alter table app.agent_traces
  add column if not exists trusted_publisher_id uuid
  references app.trusted_publishers(id) on delete set null;
create index if not exists agent_traces_public_repository_idx
  on app.agent_traces (repository_id, occurred_at desc) where is_public;

create or replace function app.sync_repository_compatibility()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  compatibility jsonb;
begin
  if new.analysis_type <> 'model' then
    return new;
  end if;
  if new.status <> 'passed' then
    delete from app.repository_compatibility where revision_id = new.revision_id;
    return new;
  end if;
  compatibility := new.result -> 'compatibility';
  if compatibility is null or jsonb_typeof(compatibility) <> 'object' then
    delete from app.repository_compatibility where revision_id = new.revision_id;
    return new;
  end if;

  insert into app.repository_compatibility (
    repository_id,
    revision_id,
    architecture,
    parameter_count,
    quantization,
    tensor_format,
    model_size_bytes,
    minimum_ram_bytes,
    minimum_vram_bytes,
    cpu_compatible,
    cuda_compatible,
    rocm_compatible,
    metal_compatible,
    mlx_compatible,
    llama_cpp_compatible,
    browser_compatible,
    confidence,
    evidence
  ) values (
    new.repository_id,
    new.revision_id,
    left(nullif(compatibility ->> 'architecture', ''), 200),
    case when compatibility ->> 'parameter_count' ~ '^[0-9]{1,18}$' then (compatibility ->> 'parameter_count')::bigint end,
    left(nullif(compatibility ->> 'quantization', ''), 200),
    left(nullif(compatibility ->> 'tensor_format', ''), 200),
    case when compatibility ->> 'model_size_bytes' ~ '^[0-9]{1,18}$' then (compatibility ->> 'model_size_bytes')::bigint else 0 end,
    case when compatibility ->> 'minimum_ram_bytes' ~ '^[0-9]{1,18}$' then (compatibility ->> 'minimum_ram_bytes')::bigint else 0 end,
    case when compatibility ->> 'minimum_vram_bytes' ~ '^[0-9]{1,18}$' then (compatibility ->> 'minimum_vram_bytes')::bigint else 0 end,
    case when jsonb_typeof(compatibility -> 'cpu_compatible') = 'boolean' then (compatibility ->> 'cpu_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'cuda_compatible') = 'boolean' then (compatibility ->> 'cuda_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'rocm_compatible') = 'boolean' then (compatibility ->> 'rocm_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'metal_compatible') = 'boolean' then (compatibility ->> 'metal_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'mlx_compatible') = 'boolean' then (compatibility ->> 'mlx_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'llama_cpp_compatible') = 'boolean' then (compatibility ->> 'llama_cpp_compatible')::boolean end,
    case when jsonb_typeof(compatibility -> 'browser_compatible') = 'boolean' then (compatibility ->> 'browser_compatible')::boolean end,
    case when compatibility ->> 'confidence' in ('declared', 'derived', 'verified') then compatibility ->> 'confidence' else 'derived' end,
    compatibility
  )
  on conflict (revision_id) do update set
    architecture = excluded.architecture,
    parameter_count = excluded.parameter_count,
    quantization = excluded.quantization,
    tensor_format = excluded.tensor_format,
    model_size_bytes = excluded.model_size_bytes,
    minimum_ram_bytes = excluded.minimum_ram_bytes,
    minimum_vram_bytes = excluded.minimum_vram_bytes,
    cpu_compatible = excluded.cpu_compatible,
    cuda_compatible = excluded.cuda_compatible,
    rocm_compatible = excluded.rocm_compatible,
    metal_compatible = excluded.metal_compatible,
    mlx_compatible = excluded.mlx_compatible,
    llama_cpp_compatible = excluded.llama_cpp_compatible,
    browser_compatible = excluded.browser_compatible,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    updated_at = now();
  return new;
end;
$$;

create or replace function app.has_repository_permission(
  p_profile_id uuid,
  p_repository_id uuid,
  p_permission text
)
returns boolean
language plpgsql
security invoker
stable
set search_path = app, pg_catalog
as $$
declare
  allowed boolean := false;
begin
  if p_permission not in ('read', 'upload', 'submit', 'review', 'publish', 'trace') then
    return false;
  end if;

  select exists (
    select 1
    from app.repositories repository
    left join app.organization_members organization_member
      on organization_member.organization_id = repository.owner_organization_id
      and organization_member.profile_id = p_profile_id
    where repository.id = p_repository_id
      and (
        repository.owner_profile_id = p_profile_id
        or organization_member.role in ('owner', 'admin')
        or (organization_member.role = 'maintainer' and p_permission in ('read', 'upload', 'submit', 'trace'))
        or exists (
          select 1
          from app.resource_group_repositories grouped_repository
          join app.resource_group_members grouped_member
            on grouped_member.resource_group_id = grouped_repository.resource_group_id
          where grouped_repository.repository_id = repository.id
            and grouped_member.profile_id = p_profile_id
            and (
              grouped_member.role = 'admin'
              or (grouped_member.role = 'maintainer' and p_permission in ('read', 'upload', 'submit', 'trace'))
              or (grouped_member.role = 'reviewer' and p_permission in ('read', 'review'))
              or (grouped_member.role = 'publisher' and p_permission in ('read', 'publish'))
              or (grouped_member.role = 'reader' and p_permission = 'read')
            )
        )
      )
  ) into allowed;
  return allowed;
end;
$$;

drop trigger if exists repository_compatibility_from_analysis on app.repository_revision_analyses;
create trigger repository_compatibility_from_analysis
after insert or update of status, result on app.repository_revision_analyses
for each row execute function app.sync_repository_compatibility();

update app.repository_revision_analyses
set result = result
where analysis_type = 'model' and status = 'passed' and jsonb_typeof(result -> 'compatibility') = 'object';

drop trigger if exists repository_compatibility_touch_updated_at on app.repository_compatibility;
create trigger repository_compatibility_touch_updated_at before update on app.repository_compatibility
for each row execute function app.touch_updated_at();
drop trigger if exists resource_groups_touch_updated_at on app.resource_groups;
create trigger resource_groups_touch_updated_at before update on app.resource_groups
for each row execute function app.touch_updated_at();
drop trigger if exists resource_group_members_touch_updated_at on app.resource_group_members;
create trigger resource_group_members_touch_updated_at before update on app.resource_group_members
for each row execute function app.touch_updated_at();
drop trigger if exists service_accounts_touch_updated_at on app.service_accounts;
create trigger service_accounts_touch_updated_at before update on app.service_accounts
for each row execute function app.touch_updated_at();
drop trigger if exists trusted_publishers_touch_updated_at on app.trusted_publishers;
create trigger trusted_publishers_touch_updated_at before update on app.trusted_publishers
for each row execute function app.touch_updated_at();

alter table app.repository_compatibility enable row level security;
alter table app.resource_groups enable row level security;
alter table app.resource_group_repositories enable row level security;
alter table app.resource_group_members enable row level security;
alter table app.service_accounts enable row level security;
alter table app.service_account_roles enable row level security;
alter table app.trusted_publishers enable row level security;
alter table app.scoped_access_tokens enable row level security;
alter table app.agent_traces enable row level security;

drop policy if exists repository_compatibility_public_read on app.repository_compatibility;
create policy repository_compatibility_public_read on app.repository_compatibility
for select using (
  exists (
    select 1 from app.repository_revisions revision
    join app.repositories repository on repository.id = revision.repository_id
    where revision.id = repository_compatibility.revision_id
      and revision.status = 'published'
      and repository.latest_revision_id = revision.id
      and repository.visibility = 'public'
      and repository.status = 'published'
  )
);

drop policy if exists resource_groups_public_read on app.resource_groups;
create policy resource_groups_public_read on app.resource_groups
for select using (
  exists (
    select 1
    from app.organizations organization
    where organization.id = resource_groups.organization_id
      and organization.is_public
  )
);

drop policy if exists resource_group_repositories_public_read on app.resource_group_repositories;
create policy resource_group_repositories_public_read on app.resource_group_repositories
for select using (
  exists (
    select 1 from app.resource_groups resource_group
    join app.organizations organization on organization.id = resource_group.organization_id
    join app.repositories repository on repository.id = resource_group_repositories.repository_id
    where resource_group.id = resource_group_repositories.resource_group_id
      and organization.is_public
      and repository.visibility = 'public'
      and repository.status = 'published'
  )
);

drop policy if exists agent_traces_public_read on app.agent_traces;
create policy agent_traces_public_read on app.agent_traces
for select using (
  is_public and exists (
    select 1 from app.repositories repository
    where repository.id = agent_traces.repository_id
      and repository.visibility = 'public'
      and repository.status = 'published'
  )
);

commit;
