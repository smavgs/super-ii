begin;

create extension if not exists pgcrypto;
create schema if not exists app;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'repository_kind') then
    create type repository_kind as enum ('model', 'dataset', 'space');
  end if;
  if not exists (select 1 from pg_type where typname = 'repository_visibility') then
    create type repository_visibility as enum ('public', 'private', 'gated');
  end if;
  if not exists (select 1 from pg_type where typname = 'repository_status') then
    create type repository_status as enum ('draft', 'review', 'published', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'plan_status') then
    create type plan_status as enum ('available', 'beta_waitlist', 'proposal');
  end if;
end
$$;

create table if not exists app.profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  handle text not null,
  display_name text not null,
  bio text,
  avatar_url text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$')
);
create unique index if not exists profiles_handle_lower_idx on app.profiles (lower(handle));

create table if not exists app.organizations (
  id uuid primary key default gen_random_uuid(),
  clerk_organization_id text unique,
  handle text not null,
  name text not null,
  description text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_handle_format check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$')
);
create unique index if not exists organizations_handle_lower_idx on app.organizations (lower(handle));

create table if not exists app.organization_members (
  organization_id uuid not null references app.organizations(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'maintainer', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

create table if not exists app.plans (
  id text primary key,
  name text not null,
  status plan_status not null,
  monthly_price_cents integer check (monthly_price_cents is null or monthly_price_cents >= 0),
  billing_unit text not null,
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.subscriptions (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text,
  clerk_organization_id text,
  plan_id text not null references app.plans(id),
  provider text not null default 'clerk_billing',
  provider_subscription_id text unique,
  status text not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_owner check (
    (clerk_user_id is not null and clerk_organization_id is null) or
    (clerk_user_id is null and clerk_organization_id is not null)
  )
);
create index if not exists subscriptions_clerk_user_idx on app.subscriptions (clerk_user_id);
create index if not exists subscriptions_clerk_org_idx on app.subscriptions (clerk_organization_id);

create table if not exists app.repositories (
  id uuid primary key default gen_random_uuid(),
  kind repository_kind not null,
  owner_handle text not null,
  slug text not null,
  title text not null,
  summary text not null,
  license text,
  visibility repository_visibility not null default 'public',
  status repository_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repositories_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$'),
  constraint repositories_publish_state check (
    (status = 'published' and published_at is not null) or status <> 'published'
  ),
  unique (owner_handle, slug)
);
create index if not exists repositories_public_catalog_idx
  on app.repositories (kind, visibility, status, published_at desc);

create table if not exists app.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  interest text not null check (interest in ('creator', 'pro', 'team', 'enterprise')),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email, interest)
);

create table if not exists app.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254),
  interest text not null check (interest in ('creator', 'pro', 'team', 'enterprise', 'security', 'privacy', 'feedback')),
  message text not null check (char_length(message) between 10 and 4000),
  network_hash text not null check (char_length(network_hash) = 64),
  user_agent text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'closed', 'spam')),
  created_at timestamptz not null default now()
);
create index if not exists contact_submissions_created_idx on app.contact_submissions (created_at desc);
create index if not exists contact_submissions_network_idx on app.contact_submissions (network_hash, created_at desc);

create table if not exists app.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists audit_events_target_idx on app.audit_events (target_type, target_id, occurred_at desc);

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.submit_contact(
  p_name text,
  p_email text,
  p_interest text,
  p_message text,
  p_network_hash text,
  p_user_agent text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  submission_id uuid;
  network_recent integer;
  email_recent integer;
begin
  select count(*) into network_recent
  from app.contact_submissions
  where network_hash = p_network_hash
    and created_at > now() - interval '5 minutes';

  select count(*) into email_recent
  from app.contact_submissions
  where email = lower(p_email)
    and created_at > now() - interval '15 minutes';

  if network_recent >= 3 or email_recent >= 2 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into app.contact_submissions (
    name,
    email,
    interest,
    message,
    network_hash,
    user_agent
  ) values (
    p_name,
    lower(p_email),
    p_interest,
    p_message,
    p_network_hash,
    nullif(p_user_agent, '')
  )
  returning id into submission_id;

  return submission_id;
end;
$$;

drop trigger if exists profiles_touch_updated_at on app.profiles;
create trigger profiles_touch_updated_at before update on app.profiles
for each row execute function app.touch_updated_at();

drop trigger if exists organizations_touch_updated_at on app.organizations;
create trigger organizations_touch_updated_at before update on app.organizations
for each row execute function app.touch_updated_at();

drop trigger if exists plans_touch_updated_at on app.plans;
create trigger plans_touch_updated_at before update on app.plans
for each row execute function app.touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on app.subscriptions;
create trigger subscriptions_touch_updated_at before update on app.subscriptions
for each row execute function app.touch_updated_at();

drop trigger if exists repositories_touch_updated_at on app.repositories;
create trigger repositories_touch_updated_at before update on app.repositories
for each row execute function app.touch_updated_at();

drop trigger if exists waitlist_touch_updated_at on app.waitlist;
create trigger waitlist_touch_updated_at before update on app.waitlist
for each row execute function app.touch_updated_at();

alter table app.profiles enable row level security;
alter table app.organizations enable row level security;
alter table app.organization_members enable row level security;
alter table app.subscriptions enable row level security;
alter table app.repositories enable row level security;
alter table app.waitlist enable row level security;
alter table app.contact_submissions enable row level security;
alter table app.audit_events enable row level security;

drop policy if exists repositories_public_read on app.repositories;
create policy repositories_public_read on app.repositories
for select
using (visibility = 'public' and status = 'published');

drop policy if exists profiles_public_read on app.profiles;
create policy profiles_public_read on app.profiles
for select
using (is_public = true);

drop policy if exists organizations_public_read on app.organizations;
create policy organizations_public_read on app.organizations
for select
using (is_public = true);

insert into app.plans (id, name, status, monthly_price_cents, billing_unit, features)
values
  ('free', 'Free', 'available', 0, 'forever', '["Public profile and organizations", "Public repositories", "Community discussions", "Basic version history"]'::jsonb),
  ('pro', 'Pro', 'beta_waitlist', 900, 'month', '["Private repositories", "Higher storage and compute limits", "Advanced publishing controls", "Priority build queue"]'::jsonb),
  ('team', 'Team', 'beta_waitlist', 2000, 'member_month', '["Role-based access", "Audit history", "Team billing", "Shared resource groups"]'::jsonb),
  ('enterprise', 'Enterprise', 'proposal', null, 'annual_agreement', '["SSO and directory sync options", "Regional deployment proposals", "Custom support plan", "Security and procurement review"]'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status,
  monthly_price_cents = excluded.monthly_price_cents,
  billing_unit = excluded.billing_unit,
  features = excluded.features,
  updated_at = now();

commit;
