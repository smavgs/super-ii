begin;

alter table app.organizations
  add column if not exists organization_type text not null default 'community',
  add column if not exists homepage_url text,
  add column if not exists logo_url text,
  add column if not exists full_name text,
  add column if not exists github_username text,
  add column if not exists twitter_username text,
  add column if not exists linkedin_url text,
  add column if not exists ai_ml_interests jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.organizations'::regclass
      and conname = 'organizations_type_allowed'
  ) then
    alter table app.organizations add constraint organizations_type_allowed check (
      organization_type in ('company', 'university', 'classroom', 'non-profit', 'government', 'community')
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.organizations'::regclass
      and conname = 'organizations_interests_array'
  ) then
    alter table app.organizations add constraint organizations_interests_array
      check (jsonb_typeof(ai_ml_interests) = 'array');
  end if;
end
$$;

alter table app.repositories
  add column if not exists owner_profile_id uuid references app.profiles(id) on delete restrict,
  add column if not exists owner_organization_id uuid references app.organizations(id) on delete restrict,
  add column if not exists default_branch text not null default 'main',
  add column if not exists card_markdown text not null default '',
  add column if not exists provenance jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repositories'::regclass
      and conname = 'repositories_single_owner'
  ) then
    alter table app.repositories add constraint repositories_single_owner check (
      owner_profile_id is null or owner_organization_id is null
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repositories'::regclass
      and conname = 'repositories_provenance_object'
  ) then
    alter table app.repositories add constraint repositories_provenance_object
      check (jsonb_typeof(provenance) = 'object');
  end if;
end
$$;

create index if not exists repositories_owner_profile_idx
  on app.repositories (owner_profile_id, updated_at desc);
create index if not exists repositories_owner_organization_idx
  on app.repositories (owner_organization_id, updated_at desc);

create table if not exists app.repository_branches (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  name text not null check (name ~ '^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9])?$'),
  head_revision_id uuid references app.repository_revisions(id) on delete set null,
  is_default boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, name)
);
create unique index if not exists repository_branches_one_default_idx
  on app.repository_branches (repository_id) where is_default;

alter table app.repository_revisions
  add column if not exists branch_id uuid references app.repository_branches(id) on delete set null,
  add column if not exists commit_sha text,
  add column if not exists manifest jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_revisions'::regclass
      and conname = 'repository_revisions_commit_sha_format'
  ) then
    alter table app.repository_revisions add constraint repository_revisions_commit_sha_format
      check (commit_sha is null or commit_sha ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repository_revisions'::regclass
      and conname = 'repository_revisions_manifest_array'
  ) then
    alter table app.repository_revisions add constraint repository_revisions_manifest_array
      check (jsonb_typeof(manifest) = 'array');
  end if;
end
$$;

create unique index if not exists repository_revisions_commit_sha_idx
  on app.repository_revisions (repository_id, commit_sha) where commit_sha is not null;
create index if not exists repository_revisions_branch_created_idx
  on app.repository_revisions (branch_id, created_at desc);

create table if not exists app.repository_uploads (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null references app.repository_revisions(id) on delete cascade,
  uploader_profile_id uuid not null references app.profiles(id) on delete cascade,
  path text not null check (
    char_length(path) between 1 and 1024
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '^/'
    and path !~ E'[\\\\]'
  ),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  expected_size_bytes bigint not null check (expected_size_bytes >= 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  storage_backend text not null default 'r2' check (storage_backend in ('r2', 'runtime')),
  storage_key text not null check (storage_key ~ '^quarantine/[a-zA-Z0-9._/-]+$'),
  provider_upload_id text,
  uploaded_parts jsonb not null default '[]'::jsonb check (jsonb_typeof(uploaded_parts) = 'array'),
  state text not null default 'initiated' check (
    state in ('initiated', 'uploading', 'uploaded', 'scanning', 'ready', 'rejected', 'aborted', 'expired')
  ),
  error_code text,
  expires_at timestamptz not null default now() + interval '7 days',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, path)
);
create index if not exists repository_uploads_owner_state_idx
  on app.repository_uploads (uploader_profile_id, state, created_at desc);
create index if not exists repository_uploads_expiry_idx
  on app.repository_uploads (expires_at) where state in ('initiated', 'uploading', 'uploaded');

create table if not exists app.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 120),
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '' check (char_length(body) <= 4000),
  href text check (href is null or href ~ '^/'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_profile_unread_idx
  on app.notifications (profile_id, created_at desc) where read_at is null;

create table if not exists app.payment_orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete restrict,
  organization_id uuid references app.organizations(id) on delete restrict,
  plan_id text not null references app.plans(id),
  seat_count integer not null default 1 check (seat_count between 1 and 100),
  provider text not null default 'nowpayments' check (provider = 'nowpayments'),
  provider_payment_id text unique,
  price_amount_cents integer not null check (price_amount_cents > 0),
  price_currency text not null default 'usd' check (price_currency = 'usd'),
  pay_currency text not null default 'usdc' check (pay_currency = 'usdc'),
  pay_network text not null default 'eth' check (pay_network = 'eth'),
  pay_amount numeric(30, 12),
  pay_address text,
  status text not null default 'created' check (
    status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired')
  ),
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_orders_profile_created_idx
  on app.payment_orders (profile_id, created_at desc);
create index if not exists payment_orders_status_created_idx
  on app.payment_orders (status, created_at desc);

create table if not exists app.papers (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$'),
  title text not null check (char_length(title) between 3 and 300),
  abstract text not null check (char_length(abstract) between 10 and 20000),
  canonical_url text,
  doi text,
  published_on date,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_profile_id, slug)
);

create table if not exists app.posts (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references app.profiles(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$'),
  title text not null check (char_length(title) between 3 and 300),
  summary text not null default '' check (char_length(summary) <= 2000),
  body text not null check (char_length(body) between 1 and 100000),
  is_public boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_profile_id, slug)
);

create table if not exists app.paper_repository_links (
  paper_id uuid not null references app.papers(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  relationship_type text not null default 'references' check (
    relationship_type in ('introduces', 'trains', 'evaluates', 'references', 'reproduces')
  ),
  created_at timestamptz not null default now(),
  primary key (paper_id, repository_id, relationship_type)
);

create or replace function app.create_organization(
  p_profile_id uuid,
  p_handle text,
  p_organization_type text,
  p_full_name text,
  p_homepage_url text,
  p_logo_url text,
  p_github_username text,
  p_twitter_username text,
  p_linkedin_url text,
  p_ai_ml_interests jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  organization_id uuid;
  normalized_handle text := lower(btrim(p_handle));
begin
  if not exists (select 1 from app.profiles where id = p_profile_id) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if normalized_handle !~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$' then
    raise exception 'invalid_organization_handle' using errcode = '22023';
  end if;
  if p_organization_type not in ('company', 'university', 'classroom', 'non-profit', 'government', 'community') then
    raise exception 'invalid_organization_type' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_ai_ml_interests, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_ai_ml_interests' using errcode = '22023';
  end if;

  insert into app.organizations (
    handle, name, full_name, organization_type, homepage_url, logo_url,
    github_username, twitter_username, linkedin_url, ai_ml_interests
  ) values (
    normalized_handle,
    left(btrim(p_full_name), 200),
    left(btrim(p_full_name), 200),
    p_organization_type,
    nullif(btrim(p_homepage_url), ''),
    nullif(btrim(p_logo_url), ''),
    nullif(btrim(p_github_username), ''),
    nullif(btrim(p_twitter_username), ''),
    nullif(btrim(p_linkedin_url), ''),
    coalesce(p_ai_ml_interests, '[]'::jsonb)
  ) returning id into organization_id;

  insert into app.organization_members (organization_id, profile_id, role)
  values (organization_id, p_profile_id, 'owner');

  insert into app.activity_events (actor_profile_id, event_type, metadata)
  values (
    p_profile_id,
    'organization.created',
    jsonb_build_object('organization_id', organization_id, 'handle', normalized_handle)
  );

  return organization_id;
end;
$$;

create or replace function app.create_repository_with_revision(
  p_profile_id uuid,
  p_organization_id uuid,
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
returns table (repository_id uuid, revision_id uuid, branch_id uuid)
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  resolved_owner_handle text;
  created_revision app.repository_revisions;
begin
  if p_slug !~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$' then
    raise exception 'invalid_repository_slug' using errcode = '22023';
  end if;
  if p_organization_id is null then
    select handle into resolved_owner_handle from app.profiles where id = p_profile_id;
  else
    select o.handle into resolved_owner_handle
    from app.organizations o
    join app.organization_members m on m.organization_id = o.id
    where o.id = p_organization_id
      and m.profile_id = p_profile_id
      and m.role in ('owner', 'admin', 'maintainer');
  end if;
  if resolved_owner_handle is null then
    raise exception 'repository_owner_not_allowed' using errcode = '42501';
  end if;

  insert into app.repositories (
    kind, owner_handle, owner_profile_id, owner_organization_id, slug, title,
    summary, license, task, library, modality, visibility, status,
    card_markdown, provenance, default_branch
  ) values (
    p_kind,
    resolved_owner_handle,
    case when p_organization_id is null then p_profile_id else null end,
    p_organization_id,
    lower(p_slug),
    left(btrim(p_title), 200),
    left(btrim(p_summary), 2000),
    nullif(btrim(p_license), ''),
    nullif(btrim(p_task), ''),
    nullif(btrim(p_library), ''),
    nullif(btrim(p_modality), ''),
    'public',
    'draft',
    left(coalesce(p_card_markdown, ''), 100000),
    coalesce(p_provenance, '{}'::jsonb),
    'main'
  ) returning id into repository_id;

  select * into created_revision
  from app.create_repository_revision(repository_id, null, 'Initial commit', p_profile_id::text);
  revision_id := created_revision.id;

  insert into app.repository_branches (
    repository_id, name, head_revision_id, is_default, created_by
  ) values (
    repository_id, 'main', revision_id, true, p_profile_id::text
  ) returning id into branch_id;

  update app.repository_revisions
  set branch_id = create_repository_with_revision.branch_id
  where id = revision_id;

  insert into app.activity_events (actor_profile_id, repository_id, event_type, metadata)
  values (p_profile_id, repository_id, 'repository.created', jsonb_build_object('kind', p_kind));

  return next;
end;
$$;

create or replace function app.mark_notification_read(
  p_notification_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  update app.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and profile_id = p_profile_id;
  return found;
end;
$$;

create or replace function app.create_repository_commit(
  p_repository_id uuid,
  p_branch_id uuid,
  p_message text,
  p_created_by text
)
returns app.repository_revisions
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_branch app.repository_branches;
  created_revision app.repository_revisions;
begin
  select * into target_branch
  from app.repository_branches
  where id = p_branch_id and repository_id = p_repository_id
  for update;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if target_branch.head_revision_id is not null and exists (
    select 1 from app.repository_revisions
    where id = target_branch.head_revision_id
      and status in ('draft', 'quarantined', 'scanning')
  ) then
    raise exception 'branch_has_editable_revision' using errcode = 'P0001';
  end if;

  select * into created_revision
  from app.create_repository_revision(
    p_repository_id,
    target_branch.head_revision_id,
    left(coalesce(p_message, ''), 2000),
    p_created_by
  );

  update app.repository_revisions
  set branch_id = p_branch_id
  where id = created_revision.id;

  if target_branch.head_revision_id is not null then
    insert into app.repository_files (
      repository_id, revision_id, path, size_bytes, mime_type, sha256,
      storage_key, storage_state, scan_status, created_by
    )
    select
      repository_id, created_revision.id, path, size_bytes, mime_type, sha256,
      storage_key, storage_state, scan_status, p_created_by
    from app.repository_files
    where revision_id = target_branch.head_revision_id
      and storage_state = 'available' and scan_status = 'clean';

    insert into app.repository_file_inspections (
      repository_file_id, inspector, status, tool_version, result, started_at, completed_at
    )
    select
      copied.id, inspection.inspector, inspection.status, inspection.tool_version,
      inspection.result, inspection.started_at, inspection.completed_at
    from app.repository_files original
    join app.repository_file_inspections inspection
      on inspection.repository_file_id = original.id
      and inspection.status in ('passed', 'skipped')
    join app.repository_files copied
      on copied.revision_id = created_revision.id and copied.path = original.path
    where original.revision_id = target_branch.head_revision_id;

    update app.repository_revisions
    set status = case when exists (
          select 1 from app.repository_files where revision_id = created_revision.id
        ) then 'quarantined'::public.repository_revision_status
        else 'draft'::public.repository_revision_status end,
        file_count = (select count(*) from app.repository_files where revision_id = created_revision.id),
        total_size_bytes = coalesce((
          select sum(size_bytes) from app.repository_files where revision_id = created_revision.id
        ), 0)
    where id = created_revision.id;
  end if;

  update app.repository_branches
  set head_revision_id = created_revision.id, updated_at = now()
  where id = p_branch_id;

  select * into created_revision from app.repository_revisions where id = created_revision.id;
  return created_revision;
end;
$$;

create or replace function app.apply_nowpayments_status(
  p_order_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.payment_orders;
  period_end timestamptz;
begin
  if p_status not in ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired') then
    raise exception 'invalid_payment_status' using errcode = '22023';
  end if;

  select * into target from app.payment_orders where id = p_order_id for update;
  if not found or target.provider <> 'nowpayments' then
    raise exception 'payment_order_not_found' using errcode = 'P0002';
  end if;
  if target.provider_payment_id is not null
    and target.provider_payment_id <> p_provider_payment_id then
    raise exception 'payment_id_mismatch' using errcode = '22023';
  end if;

  update app.payment_orders
  set provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
      status = p_status,
      provider_payload = coalesce(p_payload, '{}'::jsonb),
      paid_at = case when p_status = 'finished' then coalesce(paid_at, now()) else paid_at end,
      updated_at = now()
  where id = p_order_id;

  if p_status = 'finished' and target.status <> 'finished' then
    period_end := now() + interval '30 days';
    insert into app.subscriptions (
      clerk_user_id, clerk_organization_id, plan_id, provider,
      provider_subscription_id, status, current_period_end
    )
    select
      p.clerk_user_id,
      null,
      target.plan_id,
      'nowpayments',
      p_provider_payment_id,
      'active',
      period_end
    from app.profiles p
    where p.id = target.profile_id
    on conflict (provider_subscription_id) do update set
      status = 'active', current_period_end = excluded.current_period_end, updated_at = now();

    insert into app.notifications (profile_id, event_type, title, body, href, metadata)
    values (
      target.profile_id,
      'billing.payment_finished',
      'Your Super ii plan is active 🎉',
      'USDC payment confirmed. Your plan is active for the next 30 days.',
      '/account',
      jsonb_build_object('order_id', p_order_id, 'plan_id', target.plan_id)
    );
  end if;
  return true;
end;
$$;

create or replace function app.create_or_reuse_payment_order(
  p_profile_id uuid,
  p_organization_id uuid,
  p_plan_id text,
  p_seat_count integer,
  p_price_amount_cents integer
)
returns app.payment_orders
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.payment_orders;
begin
  if p_plan_id not in ('pro', 'team')
    or p_seat_count < 1 or p_seat_count > 100
    or p_price_amount_cents < 1 then
    raise exception 'invalid_payment_order' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':' || p_plan_id || ':' || p_seat_count::text,
    0
  ));
  select * into target
  from app.payment_orders
  where profile_id = p_profile_id
    and organization_id is not distinct from p_organization_id
    and plan_id = p_plan_id
    and seat_count = p_seat_count
    and price_amount_cents = p_price_amount_cents
    and status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
    and created_at > now() - interval '30 minutes'
  order by created_at desc
  limit 1;
  if found then return target; end if;

  insert into app.payment_orders (
    profile_id, organization_id, plan_id, seat_count, price_amount_cents
  ) values (
    p_profile_id, p_organization_id, p_plan_id, p_seat_count, p_price_amount_cents
  ) returning * into target;
  return target;
end;
$$;

create or replace function app.require_release_manifest()
returns trigger
language plpgsql
set search_path = app, pg_catalog
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.manifest_sha256 is null
      or new.commit_sha is null
      or new.commit_sha !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(new.manifest) <> 'array'
      or jsonb_array_length(new.manifest) <> new.file_count then
      raise exception 'release_manifest_incomplete' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists repository_revisions_require_release_manifest on app.repository_revisions;
create trigger repository_revisions_require_release_manifest
before update of status on app.repository_revisions
for each row execute function app.require_release_manifest();

drop trigger if exists repository_branches_touch_updated_at on app.repository_branches;
create trigger repository_branches_touch_updated_at before update on app.repository_branches
for each row execute function app.touch_updated_at();
drop trigger if exists repository_uploads_touch_updated_at on app.repository_uploads;
create trigger repository_uploads_touch_updated_at before update on app.repository_uploads
for each row execute function app.touch_updated_at();
drop trigger if exists payment_orders_touch_updated_at on app.payment_orders;
create trigger payment_orders_touch_updated_at before update on app.payment_orders
for each row execute function app.touch_updated_at();
drop trigger if exists papers_touch_updated_at on app.papers;
create trigger papers_touch_updated_at before update on app.papers
for each row execute function app.touch_updated_at();
drop trigger if exists posts_touch_updated_at on app.posts;
create trigger posts_touch_updated_at before update on app.posts
for each row execute function app.touch_updated_at();

alter table app.repository_branches enable row level security;
alter table app.repository_uploads enable row level security;
alter table app.notifications enable row level security;
alter table app.payment_orders enable row level security;
alter table app.papers enable row level security;
alter table app.posts enable row level security;
alter table app.paper_repository_links enable row level security;

drop policy if exists repository_branches_public_read on app.repository_branches;
create policy repository_branches_public_read on app.repository_branches
for select using (
  exists (
    select 1 from app.repositories r
    where r.id = repository_id and r.visibility = 'public' and r.status = 'published'
  )
);
drop policy if exists papers_public_read on app.papers;
create policy papers_public_read on app.papers for select using (is_public = true);
drop policy if exists posts_public_read on app.posts;
create policy posts_public_read on app.posts for select using (is_public = true);
drop policy if exists paper_repository_links_public_read on app.paper_repository_links;
create policy paper_repository_links_public_read on app.paper_repository_links
for select using (
  exists (select 1 from app.papers p where p.id = paper_id and p.is_public)
  and exists (
    select 1 from app.repositories r
    where r.id = repository_id and r.visibility = 'public' and r.status = 'published'
  )
);

update app.plans
set status = 'available', updated_at = now()
where id in ('pro', 'team');

commit;
