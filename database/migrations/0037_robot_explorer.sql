-- Curated references, governed company claims, and opt-in community discovery.
begin;

create table if not exists app.robot_reference_records (
  id uuid primary key,
  record_type text not null check(record_type in ('company','product')),
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=300000)
);
create table if not exists app.robot_company_claims (
  reference_company_id uuid primary key references app.robot_reference_records(id),
  organization_id uuid not null references app.organizations(id),
  claimed_by uuid not null references app.profiles(id),
  proof_kind text not null check(proof_kind in ('website-control','reviewed-authority')),
  claimed_at timestamptz not null default now()
);
create table if not exists app.robot_claim_requests (
  id uuid primary key default gen_random_uuid(),
  reference_company_id uuid not null references app.robot_reference_records(id),
  requester_id uuid not null references app.profiles(id),
  organization_id uuid references app.organizations(id),
  request_kind text not null check(request_kind in ('claim','access')),
  status text not null default 'pending' check(status in ('pending','approved','declined')),
  notes text not null default '' check(char_length(notes)<=4000),
  evidence_url text not null default '' check(app.company_product_url(evidence_url)),
  reviewed_by uuid references app.profiles(id),
  review_note text not null default '' check(char_length(review_note)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(reference_company_id,requester_id)
);
create table if not exists app.robot_reference_links (
  reference_product_id uuid not null references app.robot_reference_records(id),
  reference_company_id uuid not null references app.robot_reference_records(id),
  organization_id uuid not null references app.organizations(id),
  product_id uuid not null unique references app.company_products(id),
  created_at timestamptz not null default now(),
  primary key(reference_product_id,organization_id)
);
create index if not exists robot_claim_requests_queue_idx on app.robot_claim_requests(status,reference_company_id);
create index if not exists robot_reference_links_company_idx on app.robot_reference_links(reference_company_id,organization_id);
alter table app.robot_reference_records enable row level security;
alter table app.robot_company_claims enable row level security;
alter table app.robot_claim_requests enable row level security;
alter table app.robot_reference_links enable row level security;
revoke all on app.robot_reference_records,app.robot_company_claims,app.robot_claim_requests,app.robot_reference_links
  from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;

create or replace function app.robot_product_card(p_product uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
  select jsonb_build_object(
    'id',p.id,'record_type','product','source','company','name',p.published->>'name','name_zh',p.published->>'name_zh',
    'summary',p.published->>'summary','category',case when p.published->>'kind'='robot' then 'robot' else 'component' end,
    'company_name',c.published->>'name','company_ids',jsonb_build_array(coalesce(claim.reference_company_id,p.organization_id)),
    'country',coalesce(ref.document->>'country',''),'logo',c.published->>'logo_url','family_id',null,
    'cover',coalesce((select '/showcase-images/'||m.id::text||'.jpg' from app.showcase_media m
      where m.id::text=p.published->'image_ids'->>0 and m.status='active' and m.owner_organization_id=p.organization_id),p.published->'external_images'->0->>'url',''),
    'highlights',coalesce((select jsonb_agg(jsonb_build_object('label',s->>'label','value',s->>'value')) from
      (select value as s from jsonb_array_elements(p.published->'specs') limit 2) sample),'[]'::jsonb),
    'stage',p.published->>'stage','product_url','/products/'||o.handle||'/'||p.slug,
    'updated_at',p.published_at,'spec_count',jsonb_array_length(p.published->'specs'))
  from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
  join app.organizations o on o.id=p.organization_id
  left join lateral (select reference_company_id from app.robot_company_claims where organization_id=p.organization_id order by claimed_at limit 1) claim on true
  left join app.robot_reference_records ref on ref.id=claim.reference_company_id
  where app.context_is_verified() and p.id=p_product and p.status='published' and p.published is not null and c.published is not null and o.is_public
$$;

create or replace function app.robot_explorer_cards()
returns setof jsonb language sql stable security definer set search_path=app,pg_catalog as $$
  -- A paused maintained product stays hidden; its old reference does not reappear.
  select case when live.card is not null then live.card || jsonb_build_object('id',ref.id,'family_id',ref.document->'family_id','family_name',ref.document->'family_name','category',ref.document->'category','details_url','/robot-library/records/'||ref.id::text||'.json')
    else (ref.document-'seed') || jsonb_build_object('source','reference','logo',maker.document->>'logo','details_url','/robot-library/records/'||ref.id::text||'.json') end
  from app.robot_reference_records ref
  left join app.robot_reference_records maker on maker.id::text=ref.document->'company_ids'->>0
  left join app.robot_company_claims claim on claim.reference_company_id=maker.id
  left join app.robot_reference_links link on link.reference_product_id=ref.id and link.organization_id=claim.organization_id
  left join app.company_products product on product.id=link.product_id
  left join lateral (select app.robot_product_card(link.product_id) as card) live on true
  where app.context_is_verified() and ref.record_type='product' and (product.published_at is null or live.card is not null)
  union all
  select card from (select app.robot_product_card(p.id) as card from app.company_products p
    where p.status='published' and p.published->>'kind' in ('robot','component','hardware')
      and not exists(select 1 from app.robot_reference_links l join app.robot_company_claims c on c.reference_company_id=l.reference_company_id and c.organization_id=l.organization_id where l.product_id=p.id)) products
  where card is not null
  union all
  select jsonb_build_object('id',r.id,'record_type','product','source','community','name',r.title,'name_zh','',
    'summary',r.summary,'category','robot','company_name',coalesce(p.display_name,o.name),'company_ids',case when o.id is null then '[]'::jsonb else jsonb_build_array(o.id) end,
    'country','','logo',coalesce(p.avatar_url,o.logo_url),'family_id',null,'stage',r.project_stage,
    'cover',coalesce((select '/showcase-images/'||m.id::text||'.jpg' from app.showcase_media m where m.robot_id=r.id and m.status='active' order by position limit 1),''),
    'highlights','[]'::jsonb,'product_url','/robot/'||coalesce(p.handle,o.handle)||'/'||r.slug,'updated_at',r.updated_at)
  from app.robots r left join app.profiles p on p.id=r.owner_profile_id left join app.organizations o on o.id=r.owner_organization_id
  where app.context_is_verified() and r.visibility='public' and r.status='published'
  union all
  select (ref.document-'seed') || jsonb_build_object('source',case when page.published is not null and org.is_public then 'company' else 'reference' end,
    'claimed',claim.reference_company_id is not null,'name',coalesce(page.published->>'name',ref.document->>'name'),
    'name_zh',coalesce(page.published->>'name_zh',ref.document->>'name_zh'),
    'summary',coalesce(page.published->>'summary',ref.document->>'summary'),
    'logo',coalesce(page.published->>'logo_url',ref.document->>'logo'),
    'website',coalesce(page.published->>'website',ref.document->>'website'),
    'company_url',case when org.is_public then '/organizations/'||org.handle else null end,
    'details_url','/robot-library/records/'||ref.id::text||'.json')
  from app.robot_reference_records ref left join app.robot_company_claims claim on claim.reference_company_id=ref.id
  left join app.organizations org on org.id=claim.organization_id
  left join app.company_pages page on page.organization_id=claim.organization_id and org.is_public
  where app.context_is_verified() and ref.record_type='company'
  union all
  select jsonb_build_object('id',o.id,'record_type','company','category','company','source','company','claimed',true,
    'name',c.published->>'name','name_zh',c.published->>'name_zh','summary',c.published->>'summary','website',c.published->>'website',
    'logo',c.published->>'logo_url','country','','city','','company_url','/organizations/'||o.handle,
    'product_count',(select count(*) from app.company_products p where p.organization_id=o.id and p.status='published'))
  from app.company_pages c join app.organizations o on o.id=c.organization_id
  where app.context_is_verified() and o.is_public and c.published is not null
    and exists(select 1 from app.company_products p where p.organization_id=o.id and p.status='published' and p.published->>'kind' in ('robot','component','hardware'))
    and not exists(select 1 from app.robot_company_claims cl where cl.organization_id=o.id)
$$;

create or replace function app.search_robot_explorer(p_record_type text,p_query text,p_category text,p_source text,p_company uuid,p_country text,p_letter text,p_limit integer,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare result jsonb;
begin
  if not app.context_is_verified() or p_record_type not in ('company','product') or char_length(p_query)>120
    or p_category not in ('all','robot','hand','component') or p_source not in ('all','reference','company','community')
    or p_limit not between 1 and 24 or p_offset not between 0 and 10000 or (p_country<>'' and p_country!~'^[A-Z]{2}$')
    or (p_letter<>'' and p_letter!~'^[A-Z0-9]$') then raise exception 'robot_catalog_invalid' using errcode='22023'; end if;
  with matches as (
    select card from app.robot_explorer_cards() card
    where card->>'record_type'=p_record_type and (p_category='all' or card->>'category'=p_category or p_record_type='company')
      and (p_source='all' or card->>'source'=p_source)
      and (p_company is null or card->'company_ids' ? p_company::text)
      and (p_country='' or card->>'country'=p_country)
      and (p_letter='' or upper(left(card->>'name',1))=p_letter)
      and (p_query='' or strpos(lower(concat_ws(' ',card->>'name',card->>'name_zh',card->>'summary',card->>'company_name',card->>'family_name',card->>'search_terms')),lower(p_query))>0)
  ), families as (
    select distinct on(coalesce(nullif(card->>'family_id',''),card->>'id')) card from matches
    order by coalesce(nullif(card->>'family_id',''),card->>'id'),case when coalesce(card->>'cover','')<>'' then 0 else 1 end,card->>'name',card->>'id'
  ), page as (
    select card from families order by case when coalesce(card->>'cover',card->>'logo','')<>'' then 0 else 1 end,
      case card->>'id' when '7db14f2d-e355-4d4c-aef2-1c8495fc6c57' then 0 when 'f939b660-25ed-4a19-baa5-0c9e22ab807b' then 1 when '4c4bb7e0-8732-4837-9be7-cf5c4fc0b9dd' then 2 when '14f49143-3f3e-4a3e-94ad-86ccd1ca22b9' then 3 when 'd88d2080-fdba-4078-9068-6ac64980767e' then 4 when '188215cb-f5b2-4c7a-af1f-4db178a96841' then 5 else 6 end,
      lower(card->>'name'),card->>'id' limit p_limit offset p_offset
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(card) from page),'[]'::jsonb),'total',(select count(*) from families),'offset',p_offset,'limit',p_limit) into result;
  return result;
end $$;

create or replace function app.robot_explorer_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare card jsonb; maintained jsonb; own uuid; slug text; ref app.robot_reference_records%rowtype;
begin
  if not app.context_is_verified() then return null; end if;
  select value into card from app.robot_explorer_cards() value where value->>'id'=p_id::text limit 1;
  if card is null then return null; end if;
  if card->>'source'='company' and card->>'record_type'='product' then
    select p.organization_id,p.slug into own,slug from app.company_products p
      where p.id=p_id or p.id in (select l.product_id from app.robot_reference_links l join app.robot_company_claims c on c.reference_company_id=l.reference_company_id and c.organization_id=l.organization_id where l.reference_product_id=p_id) limit 1;
    select app.public_company_product(o.handle,slug) into maintained from app.organizations o where o.id=own;
  elsif card->>'source'='company' and card->>'record_type'='company' then
    select c.published into maintained from app.company_pages c join app.organizations o on o.id=c.organization_id
      where o.is_public and (o.id=p_id or o.id in(select organization_id from app.robot_company_claims where reference_company_id=p_id)) limit 1;
  elsif card->>'source'='community' then
    card:=card || jsonb_build_object('images',coalesce((select jsonb_agg(jsonb_build_object('url','/showcase-images/'||m.id::text||'.jpg','alt',m.alt_text) order by m.position)
      from app.showcase_media m where m.robot_id=p_id and m.status='active'),'[]'::jsonb));
  end if;
  return card || jsonb_build_object('maintained',maintained);
end $$;

-- The database context binds this to a human profile, never an arbitrary caller ID.
create or replace function app.start_robot_company_request(p_reference uuid,p_organization uuid,p_handle text,p_notes text,p_evidence text,p_authorized boolean)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog,public as $$
declare actor uuid:=app.current_profile_id(); ref app.robot_reference_records%rowtype; existing app.robot_claim_requests%rowtype; claimed app.robot_company_claims%rowtype; org uuid:=p_organization;
begin
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or actor is null or p_authorized is distinct from true then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if char_length(p_notes)>4000 or not app.company_product_url(p_evidence) then raise exception 'claim_invalid' using errcode='22023'; end if;
  select * into ref from app.robot_reference_records where id=p_reference and record_type='company';
  if ref.id is null then raise exception 'claim_reference_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-claim:'||p_reference::text,0));
  select * into claimed from app.robot_company_claims where reference_company_id=p_reference;
  select * into existing from app.robot_claim_requests where reference_company_id=p_reference and requester_id=actor for update;
  if existing.id is not null then
    update app.robot_claim_requests set notes=p_notes,evidence_url=p_evidence,
      status=case when status='declined' or (claimed.reference_company_id is not null and not app.can_manage_company(claimed.organization_id)) then 'pending' else status end,
      reviewed_by=case when status='declined' or (claimed.reference_company_id is not null and not app.can_manage_company(claimed.organization_id)) then null else reviewed_by end,
      review_note=case when status='declined' or (claimed.reference_company_id is not null and not app.can_manage_company(claimed.organization_id)) then '' else review_note end,
      request_kind=case when claimed.reference_company_id is not null and not app.can_manage_company(claimed.organization_id) then 'access' else request_kind end,
      organization_id=coalesce(claimed.organization_id,organization_id),updated_at=now() where id=existing.id returning * into existing;
    return jsonb_build_object('id',existing.id,'organization_id',existing.organization_id,'status',existing.status,'kind',existing.request_kind);
  end if;
  if claimed.reference_company_id is not null then
    org:=claimed.organization_id;
    if app.can_manage_company(org) then return jsonb_build_object('organization_id',org,'status','approved','kind','claim'); end if;
  else
    if org is null then
      org:=app.create_organization(actor,p_handle,'company',ref.document->>'name',null,null,null,null,null,'[]'::jsonb);
      update app.organizations set is_public=false where id=org;
      insert into app.company_pages(organization_id,draft) values(org,ref.document->'seed');
    elsif not app.can_manage_company(org) then raise exception 'company_permission_denied' using errcode='42501';
    else
      insert into app.company_pages(organization_id,draft) values(org,ref.document->'seed') on conflict do nothing;
    end if;
  end if;
  insert into app.robot_claim_requests(reference_company_id,requester_id,organization_id,request_kind,notes,evidence_url)
    values(p_reference,actor,org,case when claimed.reference_company_id is null then 'claim' else 'access' end,p_notes,p_evidence) returning * into existing;
  return jsonb_build_object('id',existing.id,'organization_id',org,'status',existing.status,'kind',existing.request_kind);
end $$;

create or replace function app.confirm_robot_company_claim(p_request uuid,p_authorized boolean)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare req app.robot_claim_requests%rowtype; website text; hostname text; proof app.company_website_checks%rowtype;
begin
  select * into req from app.robot_claim_requests where id=p_request;
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or req.id is null or req.requester_id is distinct from app.current_profile_id() or req.request_kind<>'claim'
    or not app.can_manage_company(req.organization_id) or p_authorized is distinct from true then raise exception 'company_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-claim:'||req.reference_company_id::text,0));
  select * into req from app.robot_claim_requests where id=p_request for update;
  if req.status not in ('pending','approved') then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if exists(select 1 from app.robot_company_claims where reference_company_id=req.reference_company_id and organization_id<>req.organization_id) then raise exception 'company_already_claimed' using errcode='23505'; end if;
  select document->>'website' into website from app.robot_reference_records where id=req.reference_company_id;
  hostname:=regexp_replace(lower(substring(website from '^https://([^/:?#]+)')),'^www\.','');
  select * into proof from app.company_website_checks where organization_id=req.organization_id;
  if hostname is null or hostname='' or proof.checked_at is null
    or regexp_replace(proof.hostname,'^www\.','') is distinct from hostname
    or proof.hostname is distinct from (select substring(draft->>'website' from '^https://([^/:?#]+)') from app.company_pages where organization_id=req.organization_id)
    then raise exception 'claim_website_proof_required' using errcode='42501'; end if;
  insert into app.robot_company_claims(reference_company_id,organization_id,claimed_by,proof_kind)
    values(req.reference_company_id,req.organization_id,app.current_profile_id(),'website-control') on conflict(reference_company_id) do nothing;
  update app.robot_claim_requests set status='approved',reviewed_by=app.current_profile_id(),review_note='Matching official website control and authority declaration',updated_at=now() where id=p_request;
  return true;
end $$;

create or replace function app.review_robot_company_request(p_request uuid,p_approve boolean,p_reason text)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare req app.robot_claim_requests%rowtype; target uuid;
begin
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or app.current_profile_id() is null or char_length(btrim(p_reason)) not between 10 and 2000 then raise exception 'claim_review_invalid' using errcode='42501'; end if;
  select * into req from app.robot_claim_requests where id=p_request;
  if req.id is null then raise exception 'claim_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-claim:'||req.reference_company_id::text,0));
  select * into req from app.robot_claim_requests where id=p_request for update;
  select organization_id into target from app.robot_company_claims where reference_company_id=req.reference_company_id;
  if req.request_kind='access' then
    if target is null or not app.can_manage_company(target) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  elsif not app.context_is_admin() then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if req.status<>'pending' then return false; end if;
  if p_approve then
    if req.request_kind='access' then
      insert into app.organization_members(organization_id,profile_id,role) values(target,req.requester_id,'admin')
        on conflict(organization_id,profile_id) do update set role=case when app.organization_members.role='owner' then 'owner' else 'admin' end;
    else
      if target is not null and target<>req.organization_id then raise exception 'company_already_claimed' using errcode='23505'; end if;
      if not exists(select 1 from app.organization_members where organization_id=req.organization_id and profile_id=req.requester_id and role in ('owner','admin')) then raise exception 'company_permission_denied' using errcode='42501'; end if;
      insert into app.robot_company_claims(reference_company_id,organization_id,claimed_by,proof_kind)
        values(req.reference_company_id,req.organization_id,app.current_profile_id(),'reviewed-authority') on conflict(reference_company_id) do nothing;
    end if;
  end if;
  update app.robot_claim_requests set status=case when p_approve then 'approved' else 'declined' end,reviewed_by=app.current_profile_id(),review_note=p_reason,updated_at=now() where id=req.id;
  return true;
end $$;

create or replace function app.robot_company_workspace(p_reference uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object(
  'reference',(select document-'seed' from app.robot_reference_records where id=p_reference and record_type='company'),
  'can_manage',coalesce((select app.can_manage_company(organization_id) from app.robot_company_claims where reference_company_id=p_reference),false),
  'claimed',exists(select 1 from app.robot_company_claims where reference_company_id=p_reference),
  'organization_id',(select organization_id from app.robot_company_claims where reference_company_id=p_reference and app.can_manage_company(organization_id)),
  'request',(select to_jsonb(r) from app.robot_claim_requests r where reference_company_id=p_reference and requester_id=app.current_profile_id()),
  'can_manage_team',exists(select 1 from app.robot_company_claims c join app.organization_members m on m.organization_id=c.organization_id where c.reference_company_id=p_reference and m.profile_id=app.current_profile_id() and m.role='owner'),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'handle',p.handle,'role',m.role)) from app.robot_company_claims c join app.organization_members m on m.organization_id=c.organization_id join app.profiles p on p.id=m.profile_id where c.reference_company_id=p_reference and app.can_manage_company(c.organization_id)),'[]'::jsonb),
  'inbox',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('requester_name',p.display_name,'requester_handle',p.handle))
    from app.robot_claim_requests r join app.profiles p on p.id=r.requester_id where r.reference_company_id=p_reference and r.status='pending'
      and ((r.request_kind='access' and exists(select 1 from app.robot_company_claims c where c.reference_company_id=p_reference and app.can_manage_company(c.organization_id))) or (r.request_kind='claim' and app.context_is_admin()))),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object('reference_id',r.id,'name',r.document->>'name','product_id',l.product_id,'status',p.status))
    from app.robot_reference_records r left join app.robot_reference_links l on l.reference_product_id=r.id and app.can_manage_company(l.organization_id)
      and l.organization_id=coalesce((select organization_id from app.robot_company_claims where reference_company_id=p_reference),
        (select organization_id from app.robot_claim_requests where reference_company_id=p_reference and requester_id=app.current_profile_id()))
    left join app.company_products p on p.id=l.product_id where r.record_type='product' and r.document->'company_ids' ? p_reference::text),'[]'::jsonb))
 where app.context_is_verified() and app.current_actor_kind()='clerk' and app.current_profile_id() is not null
$$;

create or replace function app.prepare_reference_product(p_reference uuid,p_company uuid,p_organization uuid)
returns uuid language plpgsql volatile security definer set search_path=app,pg_catalog,public as $$
declare ref app.robot_reference_records%rowtype; existing uuid; company app.company_pages%rowtype; product_slug text;
begin
  if not app.can_manage_company(p_organization) or not exists(select 1 from app.robot_claim_requests where reference_company_id=p_company and organization_id=p_organization and requester_id=app.current_profile_id() and request_kind='claim')
    and not exists(select 1 from app.robot_company_claims where reference_company_id=p_company and organization_id=p_organization)
    then raise exception 'company_permission_denied' using errcode='42501'; end if;
  select * into ref from app.robot_reference_records where id=p_reference and record_type='product' and document->'company_ids' ? p_company::text;
  if ref.id is null then raise exception 'claim_product_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-product:'||p_reference::text||':'||p_organization::text,0));
  select product_id into existing from app.robot_reference_links where reference_product_id=p_reference and organization_id=p_organization;
  if existing is not null then return existing; end if;
  select * into company from app.company_pages where organization_id=p_organization for update;
  product_slug:=left(trim(both '-' from regexp_replace(lower(ref.document->>'name'),'[^a-z0-9]+','-','g')),60)||'-'||left(p_reference::text,8);
  if product_slug like '-%' then product_slug:='product'||product_slug; end if;
  existing:=app.start_company_product(md5(p_reference::text||':'||p_organization::text)::uuid,p_organization,'',company.draft,product_slug,ref.document->'seed',company.version);
  insert into app.robot_reference_links(reference_product_id,reference_company_id,organization_id,product_id) values(p_reference,p_company,p_organization,existing);
  return existing;
end $$;

-- Publishing is a distinct, human-owned action. A plan does not prove built hardware.
create or replace function app.set_robot_publication(p_robot uuid,p_publish boolean,p_stage text)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare target app.robots%rowtype;
begin
  select * into target from app.robots where id=p_robot for update;
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or app.current_profile_id() is null or target.id is null
    or not coalesce((target.owner_profile_id=app.current_profile_id() or (target.owner_organization_id is not null and exists(select 1 from app.organization_members where organization_id=target.owner_organization_id and profile_id=app.current_profile_id() and role in ('owner','admin','maintainer')))),false)
    then raise exception 'robot_permission_denied' using errcode='42501'; end if;
  if p_stage not in ('concept','prototype','testing','production','research') then raise exception 'robot_stage_invalid' using errcode='22023'; end if;
  update app.robots set status=case when p_publish then 'published' else 'draft' end,visibility=case when p_publish then 'public' else visibility end,project_stage=p_stage,updated_at=now() where id=p_robot;
  return true;
end $$;

create or replace function app.robot_claim_workspaces()
returns setof jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object('id',ref.id,'name',ref.document->>'name','can_manage',bool_or(coalesce(app.can_manage_company(c.organization_id),false)),
 'pending',count(distinct r.id) filter(where r.status='pending'))
 from app.robot_reference_records ref left join app.robot_company_claims c on c.reference_company_id=ref.id
 left join app.robot_claim_requests r on r.reference_company_id=ref.id
 where app.context_is_verified() and app.current_actor_kind()='clerk' and app.current_profile_id() is not null and ref.record_type='company'
 and (app.can_manage_company(c.organization_id) or r.requester_id=app.current_profile_id() or (app.context_is_admin() and r.status='pending'))
 group by ref.id
$$;

create or replace function app.remove_robot_company_member(p_reference uuid,p_profile uuid)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare org uuid;
begin
  select organization_id into org from app.robot_company_claims where reference_company_id=p_reference;
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or not exists(select 1 from app.organization_members where organization_id=org and profile_id=app.current_profile_id() and role='owner')
    then raise exception 'company_permission_denied' using errcode='42501'; end if;
  delete from app.organization_members where organization_id=org and profile_id=p_profile and role<>'owner';
  return found;
end $$;

-- Do not grant mutations to machine, payment, runtime, or publishing roles.
do $$ declare signature text; begin
 foreach signature in array array[
  'app.robot_product_card(uuid)','app.robot_explorer_cards()','app.robot_claim_workspaces()','app.remove_robot_company_member(uuid,uuid)',
  'app.search_robot_explorer(text,text,text,text,uuid,text,text,integer,integer)','app.robot_explorer_detail(uuid)',
  'app.start_robot_company_request(uuid,uuid,text,text,text,boolean)','app.confirm_robot_company_claim(uuid,boolean)',
  'app.review_robot_company_request(uuid,boolean,text)','app.robot_company_workspace(uuid)',
  'app.prepare_reference_product(uuid,uuid,uuid)','app.set_robot_publication(uuid,boolean,text)'
 ] loop
  execute 'revoke all on function '||signature||' from public,superii_payment_backend,superii_publishing_backend,superii_runtime_backend';
  execute 'grant execute on function '||signature||' to superii_web_backend';
 end loop;
end $$;
commit;
