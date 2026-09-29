begin;

alter table app.profiles add column if not exists profile_kind text not null default 'person';
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_profile_kind_check' and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles add constraint profiles_profile_kind_check
      check (profile_kind in ('person','studio','company'));
  end if;
end $$;

create table if not exists app.external_catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references app.profiles(id) on delete cascade,
  owner_organization_id uuid references app.organizations(id) on delete cascade,
  external_identity_id uuid not null references app.external_identities(id) on delete restrict,
  provider text not null default 'huggingface' check (provider = 'huggingface'),
  kind public.repository_kind not null,
  provider_repo_id text not null check (provider_repo_id ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  provider_namespace text not null check (char_length(provider_namespace) between 1 and 255),
  provider_slug text not null check (char_length(provider_slug) between 1 and 255),
  source_url text not null check (source_url ~ '^https://huggingface\.co/'),
  source_revision text not null check (source_revision ~ '^[a-f0-9]{40,64}$'),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  license text check (license is null or char_length(license) <= 120),
  file_count integer not null check (file_count between 0 and 5000),
  total_size_bytes bigint not null check (total_size_bytes between 0 and 21474836480),
  provider_downloads bigint check (provider_downloads is null or provider_downloads >= 0),
  provider_likes bigint check (provider_likes is null or provider_likes >= 0),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object' and octet_length(source_metadata::text) <= 32768),
  status text not null default 'active' check (status in ('active','unavailable','removed')),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_catalog_items_exactly_one_owner check (
    (owner_profile_id is null) <> (owner_organization_id is null)
  )
);
create unique index if not exists external_catalog_items_profile_repo_idx
  on app.external_catalog_items (owner_profile_id, provider, kind, lower(provider_repo_id))
  where owner_profile_id is not null and status <> 'removed';
create unique index if not exists external_catalog_items_organization_repo_idx
  on app.external_catalog_items (owner_organization_id, provider, kind, lower(provider_repo_id))
  where owner_organization_id is not null and status <> 'removed';
create index if not exists external_catalog_items_public_idx
  on app.external_catalog_items (kind, updated_at desc, id) where status = 'active';

create table if not exists app.showcase_media (
  id uuid primary key default gen_random_uuid(),
  uploaded_by_profile_id uuid not null references app.profiles(id) on delete cascade,
  owner_profile_id uuid references app.profiles(id) on delete cascade,
  owner_organization_id uuid references app.organizations(id) on delete cascade,
  robot_id uuid references app.robots(id) on delete cascade,
  object_key text not null unique check (
    object_key ~ '^showcase/(profile|organization)/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  ),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null default 'image/jpeg' check (mime_type = 'image/jpeg'),
  byte_size integer not null check (byte_size between 512 and 600000),
  width integer not null check (width between 320 and 2400),
  height integer not null check (height between 240 and 2400),
  constraint showcase_media_ratio_check check (abs(width * 5 - height * 8) <= 8),
  title text not null default '' check (char_length(title) <= 100),
  caption text not null default '' check (char_length(caption) <= 400),
  alt_text text not null check (char_length(btrim(alt_text)) between 1 and 240),
  link_url text check (link_url is null or (link_url ~ '^https://' and char_length(link_url) <= 2048)),
  position smallint not null check (position between 1 and 3),
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint showcase_media_exactly_one_owner check (
    (owner_profile_id is null) <> (owner_organization_id is null)
  )
);
create unique index if not exists showcase_media_profile_position_idx
  on app.showcase_media (owner_profile_id, position)
  where robot_id is null and owner_profile_id is not null and status = 'active';
create unique index if not exists showcase_media_organization_position_idx
  on app.showcase_media (owner_organization_id, position)
  where robot_id is null and owner_organization_id is not null and status = 'active';
create unique index if not exists showcase_media_robot_position_idx
  on app.showcase_media (robot_id, position)
  where robot_id is not null and status = 'active';
create index if not exists showcase_media_profile_idx
  on app.showcase_media (owner_profile_id, robot_id, position) where status = 'active';
create index if not exists showcase_media_organization_idx
  on app.showcase_media (owner_organization_id, robot_id, position) where status = 'active';
create index if not exists showcase_media_uploader_idx
  on app.showcase_media (uploaded_by_profile_id, created_at);

alter table app.robots add column if not exists project_stage text not null default 'concept';
alter table app.robots add column if not exists capabilities text[] not null default '{}';
alter table app.robots add column if not exists software_summary text not null default '';
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'robots_project_stage_check' and conrelid = 'app.robots'::regclass
  ) then
    alter table app.robots add constraint robots_project_stage_check
      check (project_stage in ('concept','prototype','testing','production','research'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'robots_capabilities_check' and conrelid = 'app.robots'::regclass
  ) then
    alter table app.robots add constraint robots_capabilities_check
      check (cardinality(capabilities) <= 12 and octet_length(array_to_string(capabilities, ',')) <= 1200);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'robots_software_summary_check' and conrelid = 'app.robots'::regclass
  ) then
    alter table app.robots add constraint robots_software_summary_check
      check (char_length(software_summary) <= 2000);
  end if;
end $$;

create table if not exists app.robot_links (
  id uuid primary key default gen_random_uuid(),
  robot_id uuid not null references app.robots(id) on delete cascade,
  link_kind text not null check (link_kind in ('software','source','docs','video','cad','model','dataset','app')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  position smallint not null check (position between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (robot_id, position)
);
create index if not exists robot_links_robot_idx on app.robot_links (robot_id, position);

drop trigger if exists external_catalog_items_touch_updated_at on app.external_catalog_items;
create trigger external_catalog_items_touch_updated_at before update on app.external_catalog_items
for each row execute function app.touch_updated_at();
drop trigger if exists showcase_media_touch_updated_at on app.showcase_media;
create trigger showcase_media_touch_updated_at before update on app.showcase_media
for each row execute function app.touch_updated_at();
drop trigger if exists robot_links_touch_updated_at on app.robot_links;
create trigger robot_links_touch_updated_at before update on app.robot_links
for each row execute function app.touch_updated_at();

alter table app.external_catalog_items enable row level security;
alter table app.showcase_media enable row level security;
alter table app.robot_links enable row level security;

drop policy if exists external_catalog_items_web_read on app.external_catalog_items;
create policy external_catalog_items_web_read on app.external_catalog_items
for select to superii_web_backend using (
  app.context_is_verified() and (
    (
      status = 'active' and (
        exists (select 1 from app.profiles profile where profile.id = owner_profile_id and profile.is_public)
        or exists (select 1 from app.organizations organization where organization.id = owner_organization_id and organization.is_public)
      )
    )
    or owner_profile_id = app.current_profile_id()
    or app.can_access_organization(owner_organization_id, false)
  )
);

drop policy if exists showcase_media_web_read on app.showcase_media;
create policy showcase_media_web_read on app.showcase_media
for select to superii_web_backend using (
  app.context_is_verified() and (
    (
      status = 'active' and (
        (
          robot_id is null and (
            exists (select 1 from app.profiles profile where profile.id = owner_profile_id and profile.is_public)
            or exists (select 1 from app.organizations organization where organization.id = owner_organization_id and organization.is_public)
          )
        )
        or exists (
          select 1 from app.robots robot
          where robot.id = robot_id and robot.visibility = 'public' and robot.status = 'published'
        )
      )
    )
    or owner_profile_id = app.current_profile_id()
    or app.can_access_organization(owner_organization_id, false)
  )
);

drop policy if exists robot_links_web_read on app.robot_links;
create policy robot_links_web_read on app.robot_links
for select to superii_web_backend using (
  app.context_is_verified() and exists (
    select 1 from app.robots robot
    where robot.id = robot_id and (
      (robot.visibility = 'public' and robot.status = 'published')
      or robot.owner_profile_id = app.current_profile_id()
      or app.can_access_organization(robot.owner_organization_id, false)
    )
  )
);

grant select on app.external_catalog_items, app.showcase_media, app.robot_links to superii_web_backend;

create or replace function app.showcase_storage_available(p_byte_size integer)
returns boolean
language sql stable security definer
set search_path = app, pg_catalog
as $showcase_storage$
  select app.context_is_verified()
    and app.current_profile_id() is not null
    and p_byte_size between 512 and 600000
    and coalesce((
      select sum(media.byte_size)
      from app.showcase_media media
      where media.status = 'active'
    ), 0) + p_byte_size <= 7500000000
$showcase_storage$;

create or replace function app.showcase_uploads_remaining()
returns smallint
language sql stable security definer
set search_path = app, pg_catalog
as $showcase_remaining$
  select case
    when not app.context_is_verified() or app.current_profile_id() is null then 0::smallint
    else greatest(0, 3 - (
      select count(*)::integer
      from app.showcase_media media
      where media.uploaded_by_profile_id = app.current_profile_id()
    ))::smallint
  end
$showcase_remaining$;

create or replace function app.link_external_catalog_item(
  p_external_identity_id uuid,
  p_owner_organization_id uuid,
  p_kind public.repository_kind,
  p_provider_repo_id text,
  p_source_revision text,
  p_source_url text,
  p_title text,
  p_summary text,
  p_license text,
  p_file_count integer,
  p_total_size_bytes bigint,
  p_source_metadata jsonb
)
returns uuid
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $linked_work$
declare
  actor_profile uuid := app.current_profile_id();
  identity app.external_identities%rowtype;
  namespace text := split_part(p_provider_repo_id, '/', 1);
  slug text := split_part(p_provider_repo_id, '/', 2);
  linked_id uuid;
  current_count integer;
begin
  if not app.context_is_verified() or actor_profile is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_provider_repo_id !~ '^[^/[:space:]]+/[^/[:space:]]+$'
    or p_source_revision !~ '^[a-f0-9]{40,64}$'
    or p_source_url !~ '^https://huggingface\.co/'
    or char_length(btrim(p_title)) not between 1 and 200
    or char_length(coalesce(p_summary, '')) > 2000
    or p_file_count not between 0 and 5000
    or p_total_size_bytes not between 0 and 21474836480
    or jsonb_typeof(p_source_metadata) <> 'object'
    or octet_length(p_source_metadata::text) > 32768 then
    raise exception 'linked_work_invalid' using errcode = '22023';
  end if;
  select * into identity from app.external_identities external_identity
  where external_identity.id = p_external_identity_id
    and external_identity.profile_id = actor_profile
    and external_identity.provider = 'huggingface'
    and external_identity.revoked_at is null;
  if identity.id is null then
    raise exception 'verified_identity_required' using errcode = '42501';
  end if;

  if p_owner_organization_id is null then
    if lower(identity.provider_username) <> lower(namespace) and not exists (
      select 1 from app.namespace_claims claim
      where claim.external_identity_id = identity.id
        and claim.profile_id = actor_profile
        and claim.namespace_kind = 'personal'
        and claim.status = 'verified'
        and lower(claim.provider_namespace) = lower(namespace)
    ) then
      raise exception 'linked_namespace_not_verified' using errcode = '42501';
    end if;
  else
    if not app.can_access_organization(p_owner_organization_id, true) or not exists (
      select 1 from app.namespace_claims claim
      where claim.external_identity_id = identity.id
        and claim.organization_id = p_owner_organization_id
        and claim.namespace_kind = 'organization'
        and claim.status = 'verified'
        and lower(claim.provider_namespace) = lower(namespace)
    ) then
      raise exception 'linked_organization_not_verified' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_owner_organization_id::text, actor_profile::text) || ':linked-work', 0
  ));
  select count(*) into current_count from app.external_catalog_items item
  where item.status <> 'removed' and (
    (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
    or item.owner_organization_id = p_owner_organization_id
  );
  if current_count >= 100 and not exists (
    select 1 from app.external_catalog_items item
    where item.status <> 'removed'
      and item.provider = 'huggingface' and item.kind = p_kind
      and lower(item.provider_repo_id) = lower(p_provider_repo_id)
      and (
        (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
        or item.owner_organization_id = p_owner_organization_id
      )
  ) then
    raise exception 'linked_work_limit_reached' using errcode = '23514';
  end if;

  select item.id into linked_id from app.external_catalog_items item
  where item.status <> 'removed'
    and item.provider = 'huggingface' and item.kind = p_kind
    and lower(item.provider_repo_id) = lower(p_provider_repo_id)
    and (
      (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
      or item.owner_organization_id = p_owner_organization_id
    )
  for update;

  if linked_id is null then
    insert into app.external_catalog_items (
      owner_profile_id, owner_organization_id, external_identity_id, provider,
      kind, provider_repo_id, provider_namespace, provider_slug, source_url,
      source_revision, title, summary, license, file_count, total_size_bytes,
      provider_downloads, provider_likes, source_metadata, status, last_checked_at
    ) values (
      case when p_owner_organization_id is null then actor_profile end,
      p_owner_organization_id, identity.id, 'huggingface', p_kind,
      p_provider_repo_id, namespace, slug, p_source_url, p_source_revision,
      btrim(p_title), coalesce(p_summary, ''), nullif(btrim(coalesce(p_license, '')), ''),
      p_file_count, p_total_size_bytes,
      case when (p_source_metadata->>'provider_downloads') ~ '^[0-9]+$' then (p_source_metadata->>'provider_downloads')::bigint end,
      case when (p_source_metadata->>'provider_likes') ~ '^[0-9]+$' then (p_source_metadata->>'provider_likes')::bigint end,
      p_source_metadata, 'active', now()
    ) returning id into linked_id;
  else
    update app.external_catalog_items item set
      external_identity_id = identity.id,
      source_url = p_source_url,
      source_revision = p_source_revision,
      title = btrim(p_title),
      summary = coalesce(p_summary, ''),
      license = nullif(btrim(coalesce(p_license, '')), ''),
      file_count = p_file_count,
      total_size_bytes = p_total_size_bytes,
      provider_downloads = case when (p_source_metadata->>'provider_downloads') ~ '^[0-9]+$' then (p_source_metadata->>'provider_downloads')::bigint end,
      provider_likes = case when (p_source_metadata->>'provider_likes') ~ '^[0-9]+$' then (p_source_metadata->>'provider_likes')::bigint end,
      source_metadata = p_source_metadata,
      status = 'active',
      last_checked_at = now(),
      updated_at = now()
    where item.id = linked_id;
  end if;
  return linked_id;
end
$linked_work$;

create or replace function app.unlink_external_catalog_item(p_item_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $unlink$
declare actor_profile uuid := app.current_profile_id(); changed integer;
begin
  if not app.context_is_verified() or actor_profile is null then return false; end if;
  update app.external_catalog_items item
  set status = 'removed', updated_at = now()
  where item.id = p_item_id and (
    item.owner_profile_id = actor_profile
    or app.can_access_organization(item.owner_organization_id, true)
  );
  get diagnostics changed = row_count;
  return changed = 1;
end
$unlink$;

create or replace function app.create_showcase_media(
  p_owner_organization_id uuid,
  p_robot_id uuid,
  p_object_key text,
  p_content_hash text,
  p_byte_size integer,
  p_width integer,
  p_height integer,
  p_title text,
  p_caption text,
  p_alt_text text,
  p_link_url text
)
returns table(media_id uuid, media_position smallint)
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $showcase_create$
declare
  actor_profile uuid := app.current_profile_id();
  target_robot app.robots%rowtype;
  next_position smallint;
  created_id uuid;
  scope_key text;
  expected_key_prefix text;
  current_storage bigint;
  uploads_used integer;
begin
  if not app.context_is_verified() or actor_profile is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  expected_key_prefix := 'showcase/' || case when p_owner_organization_id is null then 'profile' else 'organization' end
    || '/' || coalesce(p_owner_organization_id, actor_profile)::text || '/';
  if p_object_key !~ '^showcase/(profile|organization)/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
    or p_object_key not like expected_key_prefix || '%'
    or p_content_hash !~ '^[a-f0-9]{64}$'
    or p_byte_size not between 512 and 600000
    or p_width not between 320 and 2400
    or p_height not between 240 and 2400
    or char_length(coalesce(p_title, '')) > 100
    or char_length(coalesce(p_caption, '')) > 400
    or char_length(btrim(coalesce(p_alt_text, ''))) not between 1 and 240
    or (p_link_url is not null and (p_link_url !~ '^https://' or char_length(p_link_url) > 2048)) then
    raise exception 'showcase_media_invalid' using errcode = '22023';
  end if;
  if p_robot_id is not null then
    select * into target_robot from app.robots robot where robot.id = p_robot_id;
    if target_robot.id is null
      or not (
        target_robot.owner_profile_id = actor_profile
        or app.can_access_organization(target_robot.owner_organization_id, true)
      )
      or target_robot.owner_organization_id is distinct from p_owner_organization_id then
      raise exception 'showcase_robot_permission_denied' using errcode = '42501';
    end if;
  elsif p_owner_organization_id is not null and not app.can_access_organization(p_owner_organization_id, true) then
    raise exception 'showcase_organization_permission_denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('showcase:global-storage', 0));
  select coalesce(sum(media.byte_size), 0) into current_storage
  from app.showcase_media media where media.status = 'active';
  if current_storage + p_byte_size > 7500000000 then
    raise exception 'showcase_storage_limit_reached' using errcode = '53100';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('showcase:uploader:' || actor_profile::text, 0));
  select count(*)::integer into uploads_used
  from app.showcase_media media
  where media.uploaded_by_profile_id = actor_profile;
  if uploads_used >= 3 then
    raise exception 'showcase_upload_limit_reached' using errcode = '23514';
  end if;

  scope_key := coalesce(p_robot_id::text, coalesce(p_owner_organization_id::text, actor_profile::text) || ':profile');
  perform pg_advisory_xact_lock(hashtextextended(scope_key || ':showcase', 0));
  select candidate.position::smallint into next_position
  from generate_series(1, 3) candidate(position)
  where not exists (
    select 1 from app.showcase_media media
    where media.status = 'active' and media.position = candidate.position and (
      (p_robot_id is not null and media.robot_id = p_robot_id)
      or (
        p_robot_id is null and media.robot_id is null and (
          (p_owner_organization_id is null and media.owner_profile_id = actor_profile)
          or media.owner_organization_id = p_owner_organization_id
        )
      )
    )
  ) order by candidate.position limit 1;
  if next_position is null then
    raise exception 'showcase_media_limit_reached' using errcode = '23514';
  end if;
  insert into app.showcase_media (
    uploaded_by_profile_id, owner_profile_id, owner_organization_id, robot_id, object_key, content_hash,
    mime_type, byte_size, width, height, title, caption, alt_text, link_url, position
  ) values (
    actor_profile,
    case when p_owner_organization_id is null then actor_profile end,
    p_owner_organization_id, p_robot_id, p_object_key, p_content_hash,
    'image/jpeg', p_byte_size, p_width, p_height, coalesce(p_title, ''),
    coalesce(p_caption, ''), btrim(p_alt_text), p_link_url, next_position
  ) returning id into created_id;
  return query select created_id, next_position;
end
$showcase_create$;

create or replace function app.update_showcase_media(
  p_media_id uuid,
  p_title text,
  p_caption text,
  p_alt_text text,
  p_link_url text,
  p_position smallint
)
returns boolean
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $showcase_update$
declare
  actor_profile uuid := app.current_profile_id();
  target app.showcase_media%rowtype;
  conflicting_id uuid;
  changed integer;
begin
  if not app.context_is_verified() or actor_profile is null
    or char_length(coalesce(p_title, '')) > 100
    or char_length(coalesce(p_caption, '')) > 400
    or char_length(btrim(coalesce(p_alt_text, ''))) not between 1 and 240
    or p_position not between 1 and 3
    or (p_link_url is not null and (p_link_url !~ '^https://' or char_length(p_link_url) > 2048)) then
    return false;
  end if;
  select * into target from app.showcase_media media
  where media.id = p_media_id and media.status = 'active'
    and (media.owner_profile_id = actor_profile or app.can_access_organization(media.owner_organization_id, true));
  if target.id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(target.robot_id::text, coalesce(target.owner_organization_id::text, target.owner_profile_id::text) || ':profile') || ':showcase', 0));
  select * into target from app.showcase_media media
  where media.id = p_media_id and media.status = 'active'
    and (media.owner_profile_id = actor_profile or app.can_access_organization(media.owner_organization_id, true))
  for update;
  if target.id is null then return false; end if;
  if target.position <> p_position then
    select media.id into conflicting_id from app.showcase_media media
    where media.status = 'active' and media.position = p_position and media.id <> target.id and (
      (target.robot_id is not null and media.robot_id = target.robot_id)
      or (
        target.robot_id is null and media.robot_id is null and (
          media.owner_profile_id = target.owner_profile_id
          or media.owner_organization_id = target.owner_organization_id
        )
      )
    ) for update;
    if conflicting_id is not null then
      update app.showcase_media set status = 'removed', updated_at = now() where id = conflicting_id;
    end if;
  end if;
  update app.showcase_media media set
    title = coalesce(p_title, ''), caption = coalesce(p_caption, ''),
    alt_text = btrim(p_alt_text), link_url = p_link_url,
    position = p_position,
    updated_at = now()
  where media.id = target.id;
  get diagnostics changed = row_count;
  if conflicting_id is not null then
    update app.showcase_media set position = target.position, status = 'active', updated_at = now()
    where id = conflicting_id;
  end if;
  return changed = 1;
end
$showcase_update$;

create or replace function app.delete_showcase_media(p_media_id uuid)
returns text
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $showcase_delete$
declare actor_profile uuid := app.current_profile_id(); deleted_key text;
begin
  if not app.context_is_verified() or actor_profile is null then return null; end if;
  update app.showcase_media media
  set status = 'removed', title = '', caption = '', alt_text = 'Removed image',
      link_url = null, updated_at = now()
  where media.id = p_media_id and media.status = 'active' and (
    media.owner_profile_id = actor_profile
    or app.can_access_organization(media.owner_organization_id, true)
  ) returning media.object_key into deleted_key;
  return deleted_key;
end
$showcase_delete$;

create or replace function app.showcase_media_delete_target(p_media_id uuid)
returns text
language sql stable security definer
set search_path = app, pg_catalog
as $showcase_delete_target$
  select media.object_key
  from app.showcase_media media
  where app.context_is_verified()
    and app.current_profile_id() is not null
    and media.id = p_media_id
    and media.status = 'active'
    and (
      media.owner_profile_id = app.current_profile_id()
      or app.can_access_organization(media.owner_organization_id, true)
    )
  limit 1
$showcase_delete_target$;

create or replace function app.resolve_public_showcase_media(p_media_id uuid)
returns table(object_key text, content_hash text, mime_type text, byte_size integer, width integer, height integer)
language sql stable security definer
set search_path = app, pg_catalog
as $showcase_public$
  select media.object_key, media.content_hash, media.mime_type, media.byte_size, media.width, media.height
  from app.showcase_media media
  where media.id = p_media_id and media.status = 'active' and (
    (
      media.robot_id is null and (
        exists (select 1 from app.profiles profile where profile.id = media.owner_profile_id and profile.is_public)
        or exists (select 1 from app.organizations organization where organization.id = media.owner_organization_id and organization.is_public)
      )
    )
    or exists (
      select 1 from app.robots robot
      where robot.id = media.robot_id and robot.visibility = 'public' and robot.status = 'published'
    )
  ) limit 1
$showcase_public$;

create or replace function app.update_robot_showcase(
  p_robot_id uuid,
  p_project_stage text,
  p_capabilities text[],
  p_software_summary text,
  p_links jsonb
)
returns boolean
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $robot_showcase$
declare actor_profile uuid := app.current_profile_id(); target app.robots%rowtype; item jsonb; item_position integer := 0;
begin
  if not app.context_is_verified() or actor_profile is null
    or p_project_stage not in ('concept','prototype','testing','production','research')
    or cardinality(p_capabilities) > 12
    or octet_length(array_to_string(p_capabilities, ',')) > 1200
    or char_length(coalesce(p_software_summary, '')) > 2000
    or jsonb_typeof(p_links) <> 'array'
    or jsonb_array_length(p_links) > 12
    or octet_length(p_links::text) > 30000 then
    return false;
  end if;
  select * into target from app.robots robot where robot.id = p_robot_id for update;
  if target.id is null or not (
    target.owner_profile_id = actor_profile or app.can_access_organization(target.owner_organization_id, true)
  ) then return false; end if;
  for item in select value from jsonb_array_elements(p_links)
  loop
    item_position := item_position + 1;
    if coalesce(item->>'kind','') not in ('software','source','docs','video','cad','model','dataset','app')
      or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80
      or coalesce(item->>'url','') !~ '^https://'
      or char_length(item->>'url') > 2048 then
      return false;
    end if;
  end loop;
  update app.robots set
    project_stage = p_project_stage,
    capabilities = p_capabilities,
    software_summary = coalesce(p_software_summary, ''),
    updated_at = now()
  where id = target.id;
  delete from app.robot_links link where link.robot_id = target.id;
  item_position := 0;
  for item in select value from jsonb_array_elements(p_links)
  loop
    item_position := item_position + 1;
    insert into app.robot_links (robot_id, link_kind, label, url, position)
    values (target.id, item->>'kind', btrim(item->>'label'), item->>'url', item_position);
  end loop;
  return true;
end
$robot_showcase$;

do $function_security$
declare signature text;
begin
  foreach signature in array array[
    'app.showcase_storage_available(integer)',
    'app.showcase_uploads_remaining()',
    'app.link_external_catalog_item(uuid,uuid,repository_kind,text,text,text,text,text,text,integer,bigint,jsonb)',
    'app.unlink_external_catalog_item(uuid)',
    'app.create_showcase_media(uuid,uuid,text,text,integer,integer,integer,text,text,text,text)',
    'app.update_showcase_media(uuid,text,text,text,text,smallint)',
    'app.showcase_media_delete_target(uuid)',
    'app.delete_showcase_media(uuid)',
    'app.resolve_public_showcase_media(uuid)',
    'app.update_robot_showcase(uuid,text,text[],text,jsonb)'
  ] loop
    execute 'revoke all on function ' || signature || ' from public';
    execute 'grant execute on function ' || signature || ' to superii_web_backend';
  end loop;
end
$function_security$;

comment on table app.external_catalog_items is
  'Ownership-verified provider metadata and outbound links; never a Super ii repository or file mirror';
comment on table app.showcase_media is
  'Public R2 image metadata with a lifetime limit of three uploads per member across profile, organization, and Robot scopes';
comment on function app.resolve_public_showcase_media(uuid) is
  'Resolves an R2 object key only while its owning profile, organization, or Robot remains public';

commit;
