-- Product claims grant only their selected reference; whole-company claims remain separate.
begin;
alter table app.robot_claim_requests add column if not exists reference_product_id uuid references app.robot_reference_records(id);
alter table app.robot_claim_requests drop constraint if exists robot_claim_requests_reference_company_id_requester_id_key;
create unique index if not exists robot_claim_request_scope_idx on app.robot_claim_requests(reference_company_id,requester_id,reference_product_id) nulls not distinct;
create table if not exists app.robot_product_claims (
 reference_product_id uuid primary key references app.robot_reference_records(id),
 reference_company_id uuid not null references app.robot_reference_records(id),
 organization_id uuid not null references app.organizations(id),
 claimed_by uuid not null references app.profiles(id),
 proof_kind text not null check(proof_kind in ('website-control','reviewed-authority')),
 claimed_at timestamptz not null default now()
);
alter table app.robot_product_claims enable row level security;
revoke all on app.robot_product_claims from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
create or replace function app.robot_claimed_organization(p_company uuid,p_product uuid default null)
returns uuid language sql stable security definer set search_path=app,pg_catalog as $$
 select coalesce((select organization_id from app.robot_product_claims where reference_product_id=p_product and reference_company_id=p_company),
   (select organization_id from app.robot_company_claims where reference_company_id=p_company)) where app.context_is_verified()
$$;


create or replace function app.start_robot_claim_request(p_reference uuid,p_product uuid,p_organization uuid,p_handle text,p_notes text,p_evidence text,p_authorized boolean)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog,public as $$
declare actor uuid:=app.current_profile_id(); ref app.robot_reference_records%rowtype; existing app.robot_claim_requests%rowtype; target uuid; org uuid:=p_organization;
begin
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or actor is null or p_authorized is distinct from true then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if char_length(p_notes)>4000 or not app.company_product_url(p_evidence) then raise exception 'claim_invalid' using errcode='22023'; end if;
  select * into ref from app.robot_reference_records where id=p_reference and record_type='company';
  if ref.id is null then raise exception 'claim_reference_invalid' using errcode='22023'; end if;
  if p_product is not null and not exists(select 1 from app.robot_reference_records where id=p_product and record_type='product' and document->'company_ids' ? p_reference::text) then raise exception 'claim_product_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-claim:'||p_reference::text,0));
  target:=app.robot_claimed_organization(p_reference,p_product);
  if p_product is not null and target is not null and not app.can_manage_company(target)
    and not exists(select 1 from app.robot_product_claims where reference_product_id=p_product and reference_company_id=p_reference)
    then raise exception 'claim_company_access_required' using errcode='42501'; end if;
  select * into existing from app.robot_claim_requests where reference_company_id=p_reference and requester_id=actor and reference_product_id is not distinct from p_product for update;
  if existing.id is not null then
    update app.robot_claim_requests set notes=p_notes,evidence_url=p_evidence,
      status=case when status='declined' or (target is not null and not app.can_manage_company(target)) then 'pending' else status end,
      reviewed_by=case when status='declined' or (target is not null and not app.can_manage_company(target)) then null else reviewed_by end,
      review_note=case when status='declined' or (target is not null and not app.can_manage_company(target)) then '' else review_note end,
      request_kind=case when target is not null and not app.can_manage_company(target) then 'access' else request_kind end,
      organization_id=coalesce(target,organization_id),updated_at=now() where id=existing.id returning * into existing;
    return jsonb_build_object('id',existing.id,'organization_id',existing.organization_id,'status',existing.status,'kind',existing.request_kind);
  end if;
  if target is not null then
    org:=target;
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
  insert into app.robot_claim_requests(reference_company_id,requester_id,organization_id,request_kind,notes,evidence_url,reference_product_id)
    values(p_reference,actor,org,case when target is null then 'claim' else 'access' end,p_notes,p_evidence,p_product) returning * into existing;
  return jsonb_build_object('id',existing.id,'organization_id',org,'status',existing.status,'kind',existing.request_kind);
end $$;

create or replace function app.start_robot_company_request(p_reference uuid,p_organization uuid,p_handle text,p_notes text,p_evidence text,p_authorized boolean)
returns jsonb language sql volatile security definer set search_path=app,pg_catalog as $$
 select app.start_robot_claim_request(p_reference,null,p_organization,p_handle,p_notes,p_evidence,p_authorized)
$$;

create or replace function app.confirm_robot_company_claim(p_request uuid,p_authorized boolean)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare req app.robot_claim_requests%rowtype; website text; hostname text; proof app.company_website_checks%rowtype;
begin
  select * into req from app.robot_claim_requests where id=p_request;
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or req.id is null or req.requester_id is distinct from app.current_profile_id() or req.request_kind<>'claim'
    or not app.can_manage_company(req.organization_id) or p_authorized is distinct from true then raise exception 'company_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-claim:'||req.reference_company_id::text,0));
  if req.reference_product_id is not null then perform pg_advisory_xact_lock(hashtextextended('robot-product-claim:'||req.reference_product_id::text,0)); end if;
  select * into req from app.robot_claim_requests where id=p_request for update;
  if req.status not in ('pending','approved') then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if app.robot_claimed_organization(req.reference_company_id,req.reference_product_id) is not null and app.robot_claimed_organization(req.reference_company_id,req.reference_product_id)<>req.organization_id then raise exception 'company_already_claimed' using errcode='23505'; end if;
  select document->>'website' into website from app.robot_reference_records where id=req.reference_company_id;
  hostname:=regexp_replace(lower(substring(website from '^https://([^/:?#]+)')),'^www\.','');
  select * into proof from app.company_website_checks where organization_id=req.organization_id;
  if hostname is null or hostname='' or proof.checked_at is null
    or regexp_replace(proof.hostname,'^www\.','') is distinct from hostname
    or proof.hostname is distinct from (select substring(draft->>'website' from '^https://([^/:?#]+)') from app.company_pages where organization_id=req.organization_id)
    then raise exception 'claim_website_proof_required' using errcode='42501'; end if;
  if req.reference_product_id is null then
  insert into app.robot_company_claims(reference_company_id,organization_id,claimed_by,proof_kind)
    values(req.reference_company_id,req.organization_id,app.current_profile_id(),'website-control') on conflict(reference_company_id) do nothing;
  else
    if exists(select 1 from app.robot_product_claims where reference_product_id=req.reference_product_id and organization_id<>req.organization_id) then raise exception 'company_already_claimed' using errcode='23505'; end if;
  insert into app.robot_product_claims(reference_product_id,reference_company_id,organization_id,claimed_by,proof_kind)
      values(req.reference_product_id,req.reference_company_id,req.organization_id,app.current_profile_id(),'website-control') on conflict(reference_product_id) do nothing;
  end if;
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
  if req.reference_product_id is not null then perform pg_advisory_xact_lock(hashtextextended('robot-product-claim:'||req.reference_product_id::text,0)); end if;
  select * into req from app.robot_claim_requests where id=p_request for update;
  target:=app.robot_claimed_organization(req.reference_company_id,req.reference_product_id);
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
      if req.reference_product_id is null then
      insert into app.robot_company_claims(reference_company_id,organization_id,claimed_by,proof_kind)
        values(req.reference_company_id,req.organization_id,app.current_profile_id(),'reviewed-authority') on conflict(reference_company_id) do nothing;
      else
        if exists(select 1 from app.robot_product_claims where reference_product_id=req.reference_product_id and organization_id<>req.organization_id) then raise exception 'company_already_claimed' using errcode='23505'; end if;
  insert into app.robot_product_claims(reference_product_id,reference_company_id,organization_id,claimed_by,proof_kind)
          values(req.reference_product_id,req.reference_company_id,req.organization_id,app.current_profile_id(),'reviewed-authority') on conflict(reference_product_id) do nothing;
      end if;
    end if;
  end if;
  update app.robot_claim_requests set status=case when p_approve then 'approved' else 'declined' end,reviewed_by=app.current_profile_id(),review_note=p_reason,updated_at=now() where id=req.id;
  return true;
end $$;

create or replace function app.prepare_reference_product(p_reference uuid,p_company uuid,p_organization uuid)
returns uuid language plpgsql volatile security definer set search_path=app,pg_catalog,public as $$
declare ref app.robot_reference_records%rowtype; existing uuid; company app.company_pages%rowtype; product_slug text;
begin
  if not app.can_manage_company(p_organization) or not exists(select 1 from app.robot_claim_requests where reference_company_id=p_company and organization_id=p_organization and requester_id=app.current_profile_id() and request_kind='claim' and (reference_product_id is null or reference_product_id=p_reference))
    and app.robot_claimed_organization(p_company,p_reference) is distinct from p_organization
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
    select 1 from app.robot_company_claims c where c.reference_company_id=l.reference_company_id and c.organization_id=l.organization_id) and not exists(select 1 from app.robot_product_claims pc where pc.reference_product_id=l.reference_product_id and pc.organization_id=l.organization_id))
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

create or replace function app.robot_product_card(p_product uuid)
returns jsonb language sql stable strict security definer set search_path=app,pg_catalog as $$
  select jsonb_build_object(
    'id',p.id,'record_type','product','source','company','name',p.published->>'name','name_zh',p.published->>'name_zh',
    'summary',p.published->>'summary','category',case when p.published->>'kind'='robot' then 'robot' else 'component' end,
    'company_name',c.published->>'name','company_ids',jsonb_build_array(coalesce(claim.reference_company_id,p.organization_id)),
    'country',coalesce(nullif(c.published->>'country',''),ref.document->>'country',''),'logo',c.published->>'logo_url','family_id',null,
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
  left join lateral (select app.robot_claimed_organization(maker.id,ref.id) as organization_id) claim on true
  left join app.robot_reference_links link on link.reference_product_id=ref.id and link.organization_id=claim.organization_id
  left join app.company_products product on product.id=link.product_id
  left join lateral (select app.robot_product_card(link.product_id) as card) live on true
  where app.context_is_verified() and ref.record_type='product' and (product.published_at is null or live.card is not null)
  union all
  select card from (select app.robot_product_card(p.id) as card from app.company_products p
    where p.status='published' and p.published->>'kind' in ('robot','component','hardware')
      and not exists(select 1 from app.robot_reference_links l where l.organization_id=app.robot_claimed_organization(l.reference_company_id,l.reference_product_id) and l.product_id=p.id)) products
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
    'claimed',claim.reference_company_id is not null,'country',coalesce(nullif(page.published->>'country',''),ref.document->>'country',''),'name',coalesce(page.published->>'name',ref.document->>'name'),
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
    'logo',c.published->>'logo_url','country',coalesce(c.published->>'country',''),'city','','company_url','/organizations/'||o.handle,
    'product_count',(select count(*) from app.company_products p where p.organization_id=o.id and p.status='published'))
  from app.company_pages c join app.organizations o on o.id=c.organization_id
  where app.context_is_verified() and o.is_public and c.published is not null
    and exists(select 1 from app.company_products p where p.organization_id=o.id and p.status='published' and p.published->>'kind' in ('robot','component','hardware'))
    and not exists(select 1 from app.robot_company_claims cl where cl.organization_id=o.id) and not exists(select 1 from app.robot_product_claims cl where cl.organization_id=o.id)
$$;

create or replace function app.robot_explorer_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare card jsonb; maintained jsonb; own uuid; slug text; ref app.robot_reference_records%rowtype;
begin
  if not app.context_is_verified() then return null; end if;
  select value into card from app.robot_explorer_cards() value where value->>'id'=p_id::text limit 1;
  if card is null then return null; end if;
  if card->>'source'='company' and card->>'record_type'='product' then
    select p.organization_id,p.slug into own,slug from app.company_products p
      where p.id=p_id or p.id in (select l.product_id from app.robot_reference_links l where l.organization_id=app.robot_claimed_organization(l.reference_company_id,l.reference_product_id) and l.reference_product_id=p_id) limit 1;
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

create or replace function app.robot_claim_workspace(p_reference uuid,p_product uuid)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare org uuid; owned boolean; req app.robot_claim_requests%rowtype; result jsonb;
begin
 if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or app.current_profile_id() is null then return null; end if;
 if p_product is not null and not exists(select 1 from app.robot_reference_records where id=p_product and record_type='product' and document->'company_ids' ? p_reference::text) then return null; end if;
 org:=app.robot_claimed_organization(p_reference,p_product); owned:=coalesce(app.can_manage_company(org),false);
 select * into req from app.robot_claim_requests where reference_company_id=p_reference and requester_id=app.current_profile_id() and reference_product_id is not distinct from p_product;
 return jsonb_build_object(
  'reference',(select document-'seed' from app.robot_reference_records where id=p_reference and record_type='company'),
  'selected_product',(select document-'seed' from app.robot_reference_records where id=p_product),
  'requires_company_access',p_product is not null and org is not null and not owned and not exists(select 1 from app.robot_product_claims where reference_product_id=p_product and reference_company_id=p_reference),
  'can_manage',owned,'claimed',org is not null,'organization_id',case when owned then org else null end,
  'request',case when req.id is not null then to_jsonb(req) else null end,
  'can_manage_team',owned and exists(select 1 from app.organization_members where organization_id=org and profile_id=app.current_profile_id() and role='owner'),
  'members',case when owned then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'handle',p.handle,'role',m.role))
    from app.organization_members m join app.profiles p on p.id=m.profile_id where m.organization_id=org),'[]'::jsonb) else '[]'::jsonb end,
  'inbox',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('requester_name',p.display_name,'requester_handle',p.handle))
    from app.robot_claim_requests r join app.profiles p on p.id=r.requester_id where r.reference_company_id=p_reference and r.reference_product_id is not distinct from p_product and r.status='pending'
      and ((r.request_kind='access' and owned) or (r.request_kind='claim' and app.context_is_admin()))),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object('reference_id',r.id,'name',r.document->>'name','cover',r.document->>'cover','product_id',l.product_id,'status',p.status))
    from app.robot_reference_records r left join app.robot_reference_links l on l.reference_product_id=r.id and app.can_manage_company(l.organization_id)
      and l.organization_id=case when owned then org when req.request_kind='claim' then req.organization_id else null end
    left join app.company_products p on p.id=l.product_id where r.record_type='product' and r.document->'company_ids' ? p_reference::text and (p_product is null or r.id=p_product)),'[]'::jsonb));
end $$;
create or replace function app.robot_company_workspace(p_reference uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$ select app.robot_claim_workspace(p_reference,null) $$;

create or replace function app.robot_claim_workspaces()
returns setof jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 with scopes as (
  select reference_company_id as id,reference_product_id as product_id from app.robot_claim_requests
   where requester_id=app.current_profile_id() or (app.context_is_admin() and status='pending')
  union select reference_company_id,null::uuid from app.robot_company_claims where app.can_manage_company(organization_id)
  union select reference_company_id,reference_product_id from app.robot_product_claims where app.can_manage_company(organization_id)
 ) select jsonb_build_object('id',s.id,'product_id',s.product_id,'name',coalesce(p.document->>'name',r.document->>'name'),'company_name',r.document->>'name',
  'can_manage',coalesce(app.can_manage_company(app.robot_claimed_organization(s.id,s.product_id)),false),
  'pending',(select count(*) from app.robot_claim_requests q where q.reference_company_id=s.id and q.reference_product_id is not distinct from s.product_id and q.status='pending'
    and (q.requester_id=app.current_profile_id() or app.context_is_admin() or (q.request_kind='access' and app.can_manage_company(q.organization_id)))))
 from scopes s join app.robot_reference_records r on r.id=s.id left join app.robot_reference_records p on p.id=s.product_id
 where app.context_is_verified() and app.current_actor_kind()='clerk' and app.current_profile_id() is not null
$$;
create or replace function app.remove_robot_claim_member(p_reference uuid,p_product uuid,p_profile uuid)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare org uuid:=app.robot_claimed_organization(p_reference,p_product);
begin
 if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or not exists(select 1 from app.organization_members where organization_id=org and profile_id=app.current_profile_id() and role='owner')
 then raise exception 'company_permission_denied' using errcode='42501'; end if;
 delete from app.organization_members where organization_id=org and profile_id=p_profile and role<>'owner';return found;
end $$;
create or replace function app.remove_robot_company_member(p_reference uuid,p_profile uuid)
returns boolean language sql volatile security definer set search_path=app,pg_catalog as $$ select app.remove_robot_claim_member(p_reference,null,p_profile) $$;

create or replace function app.robot_inquiry_destination(p_id uuid)
returns uuid language sql stable security definer set search_path=app,pg_catalog as $$
  select organization_id from (
    select claim.organization_id,-1 as priority from app.robot_product_claims claim join app.company_pages c on c.organization_id=claim.organization_id
      join app.organizations o on o.id=claim.organization_id where claim.reference_product_id=p_id and c.published is not null and o.is_public
    union all
    select p.organization_id,0 from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
      join app.organizations o on o.id=p.organization_id where p.id=p_id and p.status='published' and c.published is not null and o.is_public
    union all
    select claim.organization_id,1 from app.robot_company_claims claim join app.company_pages c on c.organization_id=claim.organization_id
      join app.organizations o on o.id=claim.organization_id where c.published is not null and o.is_public and (claim.reference_company_id=p_id or exists(
        select 1 from app.robot_reference_records r where r.id=p_id and r.document->'company_ids' ? claim.reference_company_id::text))
    union all
    select o.id,2 from app.organizations o join app.company_pages c on c.organization_id=o.id where o.id=p_id and o.is_public and c.published is not null
  ) destinations where app.context_is_verified() order by priority limit 1
$$;

do $$ declare signature text; begin
 foreach signature in array array['app.robot_claimed_organization(uuid,uuid)','app.start_robot_claim_request(uuid,uuid,uuid,text,text,text,boolean)',
 'app.robot_claim_workspace(uuid,uuid)','app.remove_robot_claim_member(uuid,uuid,uuid)'] loop
 execute 'revoke all on function '||signature||' from public,superii_payment_backend,superii_runtime_backend,superii_publishing_backend';
 execute 'grant execute on function '||signature||' to superii_web_backend';
 end loop;
end $$;
create or replace function app.save_robot_claim_contact(p_company uuid,p_product uuid,p_email text,p_wechat text,p_authorized boolean)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare org uuid:=app.robot_claimed_organization(p_company,p_product); page app.company_pages%rowtype; published_doc jsonb; patch jsonb;
begin
 if org is null or not app.can_manage_company(org) or p_authorized is distinct from true then raise exception 'company_permission_denied' using errcode='42501'; end if;
 if p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_wechat is null or char_length(p_wechat)>100 then raise exception 'contact_invalid' using errcode='22023'; end if;
 select * into page from app.company_pages where organization_id=org for update;
 patch:=jsonb_build_object('email',lower(btrim(p_email)),'wechat',btrim(p_wechat));
 -- A contact-only update never publishes unrelated private company edits.
 published_doc:=coalesce(page.published,(select document->'seed' from app.robot_reference_records where id=p_company))||patch;
 if not app.company_document_valid(published_doc) then raise exception 'contact_invalid' using errcode='22023'; end if;
 update app.company_pages set draft=draft||patch,published=published_doc,published_version=published_version+1,version=version+1,published_at=now(),updated_at=now() where organization_id=org;
 update app.organizations set is_public=true where id=org;
 return true;
end $$;
revoke all on function app.save_robot_claim_contact(uuid,uuid,text,text,boolean) from public,superii_payment_backend,superii_runtime_backend,superii_publishing_backend;
grant execute on function app.save_robot_claim_contact(uuid,uuid,text,text,boolean) to superii_web_backend;
commit;
