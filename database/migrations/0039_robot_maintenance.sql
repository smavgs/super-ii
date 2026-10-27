-- Maintainable product galleries, complete reference specifications and private-by-default plans.
begin;
create or replace function app.product_document_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = app, pg_catalog as $$
declare k text; item jsonb;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 150000
    or (p_doc - array['name','name_zh','summary','summary_zh','description','description_zh','kind','stage','source_url','specs','resources','image_ids','external_images']) <> '{}'::jsonb then return false; end if;
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
  if jsonb_array_length(p_doc->'specs') > 256 or jsonb_array_length(p_doc->'resources') > 12
    or jsonb_array_length(p_doc->'image_ids') > 3 then return false; end if;
  for item in select value from jsonb_array_elements(p_doc->'specs') loop
    if jsonb_typeof(item) <> 'object' or item - array['label','label_zh','value','value_zh','source_url'] <> '{}'::jsonb
      or not coalesce(app.company_product_text(item,'label',100) and app.company_product_text(item,'label_zh',100)
      and app.company_product_text(item,'value',2000) and app.company_product_text(item,'value_zh',2000)
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
  if p_doc ? 'external_images' then
    if jsonb_typeof(p_doc->'external_images') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_doc->'external_images') + jsonb_array_length(p_doc->'image_ids') > 12 then return false; end if;
    for item in select value from jsonb_array_elements(p_doc->'external_images') loop
      if jsonb_typeof(item) <> 'object' or item - array['url','alt','source_url'] <> '{}'::jsonb
        or not coalesce(app.company_product_text(item,'url',2048) and app.company_product_text(item,'alt',500)
          and app.company_product_text(item,'source_url',2048),false)
        or (item->>'url')='' or not app.company_product_url(item->>'url') or not app.company_product_url(item->>'source_url') then return false; end if;
    end loop;
  end if;
  return (select count(*) = count(distinct value) from jsonb_array_elements_text(p_doc->'image_ids'));
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
  if (select count(*) from app.company_products where organization_id=organization) >= 1000 then raise exception 'product_limit_reached' using errcode='23514'; end if;
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
      and m.robot_id is null and m.status='active'),'[]'::jsonb) ||
      coalesce((select jsonb_agg(jsonb_build_object('id','external-'||ordinality::text,'title','','caption',value->>'source_url','alt_text',value->>'alt','image_url',value->>'url'))
        from jsonb_array_elements(coalesce(p.published->'external_images','[]'::jsonb)) with ordinality),'[]'::jsonb))
  from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
  join app.organizations o on o.id=p.organization_id
  left join app.company_website_checks verification on verification.organization_id=p.organization_id
  where app.context_is_verified() and o.is_public and o.handle=p_owner and p.slug=p_slug
    and p.status='published' and p.published is not null and c.published is not null
$$;
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
      where media.uploaded_by_profile_id = app.current_profile_id() and media.status = 'active'
    ))::smallint
  end
$showcase_remaining$;
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
  where media.uploaded_by_profile_id = actor_profile and media.status = 'active';
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
  values (case when p_organization_id is null then p_profile_id end, p_organization_id, p_slug, btrim(p_title), btrim(p_summary), btrim(p_audience), p_visibility, 'draft', p_profile_id)
  returning id into new_robot_id;
  insert into app.robot_versions (robot_id, version_number, planner_input, plan_snapshot, catalog_revision, change_summary, created_by_profile_id, created_by_agent_id)
  values (new_robot_id, 1, p_planner_input, p_plan_snapshot, p_catalog_revision, btrim(p_change_summary), p_profile_id, p_agent_id)
  returning id into new_version_id;
  update app.robots set latest_version_id = new_version_id where id = new_robot_id;
  return query select new_robot_id, new_version_id, resolved_owner_handle, 1;
end $$;

alter table app.robots alter column status set default 'draft';
create or replace function app.publish_company_product(p_product uuid,p_version integer,p_company_version integer,p_authorized boolean)
returns jsonb language plpgsql volatile security definer set search_path = app, pg_catalog as $$
declare target app.company_products%rowtype; company app.company_pages%rowtype;
begin
  select * into target from app.company_products where id=p_product;
  if target.id is null or not app.can_manage_company(target.organization_id) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  select * into company from app.company_pages where organization_id=target.organization_id for update;
  select * into target from app.company_products where id=p_product for update;
  if target.version is distinct from p_version or company.version is distinct from p_company_version then raise exception 'product_version_conflict' using errcode='40001'; end if;
  if exists(select 1 from app.robot_reference_links l where l.product_id=p_product and not exists(
    select 1 from app.robot_company_claims c where c.reference_company_id=l.reference_company_id and c.organization_id=l.organization_id))
    then raise exception 'company_claim_required' using errcode='42501'; end if;
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
commit;
