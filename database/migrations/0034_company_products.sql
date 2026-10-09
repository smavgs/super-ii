-- Company-owned product presentations. These are declared product information,
-- not inspected repository releases or product certification.
begin;

create or replace function app.company_product_text(p_doc jsonb, p_key text, p_max integer)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p_doc->p_key) = 'string' and char_length(p_doc->>p_key) <= p_max
$$;

create or replace function app.company_product_url(p_url text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_url = '' or (char_length(p_url) <= 2048
    and p_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z0-9-]+(:443)?(/|$)'
    and p_url !~ '[[:cntrl:]]'
    and p_url !~* '^https://([^/]*\.)?(localhost|local|internal|test|invalid|onion)(:|/)')
$$;

create or replace function app.company_document_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = app, pg_catalog as $$
declare k text;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 14000
    or (p_doc - array['name','name_zh','summary','summary_zh','website','logo_url','email','phone','wechat','representative_card_url']) <> '{}'::jsonb then return false; end if;
  foreach k in array array['name','name_zh','summary','summary_zh','website','logo_url','email','phone','wechat','representative_card_url'] loop
    if not coalesce(app.company_product_text(p_doc,k,case when k in ('name','name_zh') then 160
      when k in ('summary','summary_zh') then 600 when k='email' then 254 when k='phone' then 40
      when k='wechat' then 100 when k='representative_card_url' then 200 else 2048 end),false) then return false; end if;
  end loop;
  return app.company_product_url(p_doc->>'website') and app.company_product_url(p_doc->>'logo_url')
    and (p_doc->>'phone') ~ '^[+0-9 ()-]*$'
    and ((p_doc->>'email') = '' or (p_doc->>'email') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    and ((p_doc->>'representative_card_url') = '' or (p_doc->>'representative_card_url') ~ '^https://(www\.)?superii\.site/c/[A-Za-z0-9_-]{43}$');
end $$;

create or replace function app.product_document_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = app, pg_catalog as $$
declare k text; item jsonb;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 150000
    or (p_doc - array['name','name_zh','summary','summary_zh','description','description_zh','kind','stage','source_url','specs','resources','image_ids']) <> '{}'::jsonb then return false; end if;
  foreach k in array array['name','name_zh','summary','summary_zh','description','description_zh','kind','stage','source_url'] loop
    if not coalesce(app.company_product_text(p_doc,k,case when k in ('name','name_zh') then 160
      when k in ('summary','summary_zh') then 600 when k in ('description','description_zh') then 12000
      when k='source_url' then 2048 else 30 end),false) then return false; end if;
  end loop;
  if (p_doc->>'kind') not in ('model','robot','component','hardware')
    or (p_doc->>'stage') not in ('available','prototype','research','discontinued')
    or not app.company_product_url(p_doc->>'source_url') then return false; end if;
  foreach k in array array['specs','resources','image_ids'] loop
    if jsonb_typeof(p_doc->k) is distinct from 'array' then return false; end if;
  end loop;
  if jsonb_array_length(p_doc->'specs') > 20 or jsonb_array_length(p_doc->'resources') > 12
    or jsonb_array_length(p_doc->'image_ids') > 3 then return false; end if;
  for item in select value from jsonb_array_elements(p_doc->'specs') loop
    if jsonb_typeof(item) <> 'object' or item - array['label','label_zh','value','value_zh','source_url'] <> '{}'::jsonb
      or not coalesce(app.company_product_text(item,'label',100) and app.company_product_text(item,'label_zh',100)
      and app.company_product_text(item,'value',500) and app.company_product_text(item,'value_zh',500)
      and app.company_product_text(item,'source_url',2048),false)
      or char_length(btrim(item->>'label')) < 1 or char_length(btrim(item->>'value')) < 1
      or not app.company_product_url(item->>'source_url') then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_doc->'resources') loop
    if jsonb_typeof(item) <> 'object' or item - array['label','label_zh','kind','url'] <> '{}'::jsonb
      or not coalesce(app.company_product_text(item,'label',100) and app.company_product_text(item,'label_zh',100)
      and app.company_product_text(item,'kind',30) and app.company_product_text(item,'url',2048),false)
      or char_length(btrim(item->>'label')) < 1 or (item->>'url') = ''
      or (item->>'kind') not in ('website','documentation','datasheet','sdk','source','model','video')
      or not app.company_product_url(item->>'url') then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_doc->'image_ids') loop
    if jsonb_typeof(item) <> 'string' or item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  end loop;
  return (select count(*) = count(distinct value) from jsonb_array_elements_text(p_doc->'image_ids'));
end $$;

create table if not exists app.company_pages (
  organization_id uuid primary key references app.organizations(id) on delete cascade,
  draft jsonb not null check (app.company_document_valid(draft)),
  published jsonb check (published is null or app.company_document_valid(published)),
  version integer not null default 0 check (version >= 0),
  published_version integer not null default 0 check (published_version >= 0),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists app.company_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.company_pages(organization_id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  created_by_profile_id uuid not null references app.profiles(id),
  creation_key uuid not null,
  draft jsonb not null check (app.product_document_valid(draft)),
  published jsonb check (published is null or app.product_document_valid(published)),
  status text not null default 'draft' check (status in ('draft','published','paused')),
  version integer not null default 0 check (version >= 0),
  published_version integer not null default 0 check (published_version >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,slug), unique(created_by_profile_id,creation_key)
);
create index if not exists company_products_owner_idx on app.company_products(organization_id,updated_at desc);
create index if not exists company_products_public_idx on app.company_products(published_at desc) where status='published';
create table if not exists app.company_website_checks (
  organization_id uuid primary key references app.company_pages(organization_id) on delete cascade,
  hostname text not null check (char_length(hostname) between 3 and 253 and hostname ~ '^[a-z0-9.-]+$'),
  challenge text not null check (challenge ~ '^[a-f0-9]{48}$'),
  expires_at timestamptz not null,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table app.company_pages enable row level security;
alter table app.company_products enable row level security;
alter table app.company_website_checks enable row level security;
revoke all on app.company_pages,app.company_products,app.company_website_checks
  from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;

create or replace function app.can_manage_company(p_organization uuid)
returns boolean language sql stable security definer set search_path = app, pg_catalog as $$
  select app.context_is_verified() and app.current_actor_kind() = 'clerk' and exists (
    select 1 from app.organization_members where organization_id=p_organization
      and profile_id=app.current_profile_id() and role in ('owner','admin')
  )
$$;

create or replace function app.company_product_references_valid(p_organization uuid,p_company jsonb,p_product jsonb)
returns boolean language plpgsql stable security definer set search_path = app, pg_catalog, public as $$
declare media_id text; card_token text;
begin
  for media_id in select value from jsonb_array_elements_text(p_product->'image_ids') loop
    if not exists (select 1 from app.showcase_media where id=media_id::uuid
      and owner_organization_id=p_organization and robot_id is null and status='active') then return false; end if;
  end loop;
  card_token := substring(p_company->>'representative_card_url' from '/c/([A-Za-z0-9_-]{43})$');
  if coalesce(p_company->>'representative_card_url','') <> '' and not exists (
    select 1 from app.cards card join app.card_public_snapshots snapshot on snapshot.card_id=card.id
    join app.organization_members member on member.profile_id=card.owner_profile_id and member.organization_id=p_organization
    where card.share_token_hash=encode(public.digest(card_token,'sha256'),'hex') and card.status='active'
  ) then return false; end if;
  return true;
end $$;

create or replace function app.start_company_product(
  p_creation_key uuid,p_organization uuid,p_handle text,p_company jsonb,p_slug text,p_product jsonb,p_company_version integer
) returns uuid language plpgsql volatile security definer set search_path = app, pg_catalog, public as $$
declare actor uuid := app.current_profile_id(); organization uuid:=p_organization; product_id uuid; current_company app.company_pages%rowtype;
begin
  if not app.context_is_verified() or app.current_actor_kind() <> 'clerk' or actor is null then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if p_creation_key is null or not app.company_document_valid(p_company) or not app.product_document_valid(p_product) then raise exception 'product_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('product-create:' || actor::text || ':' || p_creation_key::text,0));
  select id into product_id from app.company_products where created_by_profile_id=actor and creation_key=p_creation_key;
  if product_id is not null then
    if not app.can_manage_company((select organization_id from app.company_products where id=product_id)) then raise exception 'company_permission_denied' using errcode='42501'; end if;
    return product_id;
  end if;
  if organization is null then
    organization := app.create_organization(actor,p_handle,'company',coalesce(nullif(p_company->>'name',''),p_company->>'name_zh'),null,null,null,null,null,'[]'::jsonb);
    update app.organizations set is_public=false where id=organization;
  elsif not app.can_manage_company(organization) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('company-products:' || organization::text,0));
  if (select count(*) from app.company_products where organization_id=organization) >= 100 then raise exception 'product_limit_reached' using errcode='23514'; end if;
  insert into app.company_pages(organization_id,draft) values(organization,p_company) on conflict do nothing;
  select * into current_company from app.company_pages where organization_id=organization for update;
  if current_company.version is distinct from p_company_version then raise exception 'product_version_conflict' using errcode='40001'; end if;
  if current_company.draft is distinct from p_company then
    update app.company_pages set draft=p_company,version=version+1,updated_at=now() where organization_id=organization;
  end if;
  if not app.company_product_references_valid(organization,p_company,p_product) then raise exception 'product_reference_denied' using errcode='42501'; end if;
  insert into app.company_products(organization_id,slug,created_by_profile_id,creation_key,draft)
    values(organization,p_slug,actor,p_creation_key,p_product) returning id into product_id;
  return product_id;
end $$;

create or replace function app.company_product_draft(p_product uuid)
returns jsonb language sql stable security definer set search_path = app, pg_catalog as $$
  select jsonb_build_object('id',p.id,'organization_id',p.organization_id,'owner',o.handle,'slug',p.slug,
    'version',p.version,'company_version',c.version,'company',c.draft,'product',p.draft,'status',p.status,'published_at',p.published_at)
  from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
  join app.organizations o on o.id=p.organization_id
  where p.id=p_product and app.can_manage_company(p.organization_id)
$$;

create or replace function app.company_product_workspace()
returns jsonb language sql stable security definer set search_path = app, pg_catalog as $$
  select jsonb_build_object(
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'handle',o.handle,'name',o.full_name,
      'company',coalesce(c.draft,jsonb_build_object('name',o.full_name,'name_zh','','summary',coalesce(o.description,''),'summary_zh','',
       'website',coalesce(o.homepage_url,''),'logo_url',coalesce(o.logo_url,''),'email','','phone','','wechat','','representative_card_url','')),
      'version',coalesce(c.version,0)) order by o.full_name)
      from app.organizations o left join app.company_pages c on c.organization_id=o.id where app.can_manage_company(o.id)),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'owner',o.handle,'slug',p.slug,
      'name',coalesce(nullif(p.draft->>'name',''),p.draft->>'name_zh'),'kind',p.draft->>'kind','status',p.status,
      'updated_at',p.updated_at) order by p.updated_at desc)
      from app.company_products p join app.organizations o on o.id=p.organization_id where app.can_manage_company(p.organization_id)),'[]'::jsonb)
  )
$$;

create or replace function app.save_company_product(p_product uuid,p_version integer,p_company_version integer,p_company jsonb,p_document jsonb)
returns jsonb language plpgsql volatile security definer set search_path = app, pg_catalog as $$
declare target app.company_products%rowtype; company app.company_pages%rowtype;
begin
  select * into target from app.company_products where id=p_product;
  if target.id is null or not app.can_manage_company(target.organization_id) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  -- Every mutation locks company before product to make concurrent edits deterministic.
  select * into company from app.company_pages where organization_id=target.organization_id for update;
  select * into target from app.company_products where id=p_product for update;
  if target.version is distinct from p_version or company.version is distinct from p_company_version then raise exception 'product_version_conflict' using errcode='40001'; end if;
  if not app.company_document_valid(p_company) or not app.product_document_valid(p_document) then raise exception 'product_invalid' using errcode='22023'; end if;
  if not app.company_product_references_valid(target.organization_id,p_company,p_document) then raise exception 'product_reference_denied' using errcode='42501'; end if;
  update app.company_pages set draft=p_company,version=version+1,updated_at=now() where organization_id=target.organization_id;
  update app.company_products set draft=p_document,version=version+1,updated_at=now() where id=p_product;
  return app.company_product_draft(p_product);
end $$;

create or replace function app.publish_company_product(p_product uuid,p_version integer,p_company_version integer,p_authorized boolean)
returns jsonb language plpgsql volatile security definer set search_path = app, pg_catalog as $$
declare target app.company_products%rowtype; company app.company_pages%rowtype;
begin
  select * into target from app.company_products where id=p_product;
  if target.id is null or not app.can_manage_company(target.organization_id) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  select * into company from app.company_pages where organization_id=target.organization_id for update;
  select * into target from app.company_products where id=p_product for update;
  if target.version is distinct from p_version or company.version is distinct from p_company_version then raise exception 'product_version_conflict' using errcode='40001'; end if;
  if p_authorized is distinct from true then raise exception 'company_authority_confirmation_required' using errcode='22023'; end if;
  if char_length(coalesce(nullif(company.draft->>'name',''),company.draft->>'name_zh')) < 2
    or char_length(coalesce(nullif(target.draft->>'name',''),target.draft->>'name_zh')) < 2
    or char_length(coalesce(nullif(target.draft->>'summary',''),target.draft->>'summary_zh')) < 10
    or concat(company.draft->>'email',company.draft->>'phone',company.draft->>'wechat',company.draft->>'representative_card_url') = '' then raise exception 'product_not_ready' using errcode='22023'; end if;
  if not app.company_product_references_valid(target.organization_id,company.draft,target.draft) then raise exception 'product_reference_denied' using errcode='42501'; end if;
  update app.company_pages set published=draft,published_version=published_version+1,version=version+1,published_at=now(),updated_at=now() where organization_id=target.organization_id;
  update app.company_products set published=draft,published_version=published_version+1,version=version+1,status='published',published_at=now(),updated_at=now() where id=p_product;
  update app.organizations set is_public=true,full_name=coalesce(nullif(company.draft->>'name',''),company.draft->>'name_zh'),
    name=coalesce(nullif(company.draft->>'name',''),company.draft->>'name_zh'),description=coalesce(nullif(company.draft->>'summary',''),company.draft->>'summary_zh'),
    homepage_url=nullif(company.draft->>'website',''),logo_url=nullif(company.draft->>'logo_url','') where id=target.organization_id;
  return app.company_product_draft(p_product);
end $$;

create or replace function app.pause_company_product(p_product uuid,p_version integer)
returns boolean language plpgsql volatile security definer set search_path = app, pg_catalog as $$
declare target app.company_products%rowtype;
begin
  select * into target from app.company_products where id=p_product for update;
  if target.id is null or not app.can_manage_company(target.organization_id) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if target.version is distinct from p_version then raise exception 'product_version_conflict' using errcode='40001'; end if;
  update app.company_products set status='paused',version=version+1,updated_at=now() where id=p_product;
  return true;
end $$;

create or replace function app.company_product_media(p_organization uuid)
returns table(id uuid,title text,caption text,alt_text text,object_key text,mime_type text,content_hash text)
language sql stable security definer set search_path = app, pg_catalog as $$
  select m.id,m.title,m.caption,m.alt_text,m.object_key,m.mime_type,m.content_hash from app.showcase_media m
  where m.owner_organization_id=p_organization and m.robot_id is null and m.status='active'
    and app.can_manage_company(p_organization) order by m.position
$$;

create or replace function app.public_company_product(p_owner text,p_slug text)
returns jsonb language sql stable security definer set search_path = app, pg_catalog, public as $$
  select jsonb_build_object('id',p.id,'organization_id',p.organization_id,'owner',o.handle,'slug',p.slug,
    'version',p.published_version,'company_version',c.published_version,'published_at',p.published_at,
    'company',case when coalesce(c.published->>'representative_card_url','')='' or exists (
      select 1 from app.cards card join app.card_public_snapshots snapshot on snapshot.card_id=card.id
      join app.organization_members member on member.profile_id=card.owner_profile_id and member.organization_id=p.organization_id
      where card.status='active' and card.share_token_hash=encode(public.digest(substring(c.published->>'representative_card_url' from '/c/([A-Za-z0-9_-]{43})$'),'sha256'),'hex')
    ) then c.published else jsonb_set(c.published,'{representative_card_url}','""'::jsonb) end,
    'product',p.published,'website_control',case when verification.checked_at is not null
      and verification.hostname=substring(c.published->>'website' from '^https://([^/:?#]+)')
      then jsonb_build_object('hostname',verification.hostname,'checked_at',verification.checked_at) else null end,
    'images',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'caption',m.caption,'alt_text',m.alt_text,
      'image_url','/showcase-images/' || m.id::text || '.jpg') order by selected.ordinality)
      from jsonb_array_elements_text(p.published->'image_ids') with ordinality selected(id,ordinality)
      join app.showcase_media m on m.id=selected.id::uuid and m.owner_organization_id=p.organization_id
      and m.robot_id is null and m.status='active'),'[]'::jsonb))
  from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
  join app.organizations o on o.id=p.organization_id
  left join app.company_website_checks verification on verification.organization_id=p.organization_id
  where app.context_is_verified() and o.is_public and o.handle=p_owner and p.slug=p_slug
    and p.status='published' and p.published is not null and c.published is not null
$$;

create or replace function app.search_company_products(p_query text,p_kind text,p_owner text,p_limit integer,p_offset integer)
returns setof jsonb language sql stable security definer set search_path = app, pg_catalog as $$
  select app.public_company_product(o.handle,p.slug)
  from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
  join app.organizations o on o.id=p.organization_id
  where app.context_is_verified() and char_length(coalesce(p_query,'')) <= 120
    and p_limit between 1 and 50 and p_offset between 0 and 10000
    and o.is_public and p.status='published' and p.published is not null and c.published is not null
    and (p_kind is null or p.published->>'kind'=p_kind) and (p_owner is null or o.handle=p_owner)
    and (coalesce(p_query,'')='' or concat_ws(' ',p.published->>'name',p.published->>'name_zh',p.published->>'summary',p.published->>'summary_zh',c.published->>'name',c.published->>'name_zh') ilike '%' || replace(replace(replace(p_query,'\','\\'),'%','\%'),'_','\_') || '%')
  order by p.published_at desc,p.id limit greatest(0,least(p_limit,50)) offset greatest(0,least(p_offset,10000))
$$;

create or replace function app.start_company_website_check(p_organization uuid,p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = app, pg_catalog, public as $$
declare current_check app.company_website_checks%rowtype;
begin
  if not app.can_manage_company(p_organization) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if p_hostname is distinct from (select substring(draft->>'website' from '^https://([^/:?#]+)') from app.company_pages where organization_id=p_organization)
    or p_hostname is null then raise exception 'website_does_not_match' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('company-dns:' || p_organization::text,0));
  select * into current_check from app.company_website_checks where organization_id=p_organization;
  if current_check.hostname=p_hostname and (current_check.expires_at>now() or current_check.checked_at is not null) then
    return jsonb_build_object('hostname',current_check.hostname,'challenge',current_check.challenge,'expires_at',current_check.expires_at,'checked_at',current_check.checked_at);
  end if;
  insert into app.company_website_checks(organization_id,hostname,challenge,expires_at)
    values(p_organization,p_hostname,encode(public.gen_random_bytes(24),'hex'),now()+interval '7 days')
    on conflict(organization_id) do update set hostname=excluded.hostname,challenge=excluded.challenge,
      expires_at=excluded.expires_at,checked_at=null,created_at=now() returning * into current_check;
  return jsonb_build_object('hostname',current_check.hostname,'challenge',current_check.challenge,'expires_at',current_check.expires_at,'checked_at',current_check.checked_at);
end $$;

create or replace function app.complete_company_website_check(p_organization uuid,p_hostname text,p_challenge text)
returns boolean language plpgsql volatile security definer set search_path = app, pg_catalog as $$
begin
  if not app.can_manage_company(p_organization) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  update app.company_website_checks verification set checked_at=now()
  where verification.organization_id=p_organization and hostname=p_hostname and challenge=p_challenge and expires_at>now()
    and p_hostname=(select substring(draft->>'website' from '^https://([^/:?#]+)') from app.company_pages where organization_id=p_organization);
  return found;
end $$;

-- No direct web reads can accidentally expose unpublished JSON or TXT challenges.
-- Public gateways return only explicit published snapshots; write gateways require
-- a signed Clerk profile and current owner/admin membership, including on retries.
do $$ declare signature text; begin
  foreach signature in array array[
    'app.company_product_text(jsonb,text,integer)','app.company_product_url(text)',
    'app.company_document_valid(jsonb)','app.product_document_valid(jsonb)','app.can_manage_company(uuid)',
    'app.company_product_references_valid(uuid,jsonb,jsonb)',
    'app.start_company_product(uuid,uuid,text,jsonb,text,jsonb,integer)','app.company_product_draft(uuid)',
    'app.company_product_workspace()','app.save_company_product(uuid,integer,integer,jsonb,jsonb)',
    'app.publish_company_product(uuid,integer,integer,boolean)','app.pause_company_product(uuid,integer)',
    'app.company_product_media(uuid)','app.public_company_product(text,text)',
    'app.search_company_products(text,text,text,integer,integer)',
    'app.start_company_website_check(uuid,text)','app.complete_company_website_check(uuid,text,text)'
  ] loop
    execute 'revoke all on function ' || signature || ' from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend';
  end loop;
  foreach signature in array array[
    'app.start_company_product(uuid,uuid,text,jsonb,text,jsonb,integer)','app.company_product_draft(uuid)',
    'app.company_product_workspace()','app.save_company_product(uuid,integer,integer,jsonb,jsonb)',
    'app.publish_company_product(uuid,integer,integer,boolean)','app.pause_company_product(uuid,integer)',
    'app.company_product_media(uuid)','app.public_company_product(text,text)',
    'app.search_company_products(text,text,text,integer,integer)',
    'app.start_company_website_check(uuid,text)','app.complete_company_website_check(uuid,text,text)'
  ] loop execute 'grant execute on function ' || signature || ' to superii_web_backend'; end loop;
end $$;

comment on table app.company_products is 'Company-provided product presentations. Publication is not repository verification or product certification.';
comment on table app.company_website_checks is 'Control of an exact website hostname only; never legal company identity or product validation.';
commit;
