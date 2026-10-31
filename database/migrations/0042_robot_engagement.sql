-- Private company inquiries and public engagement counts.
begin;
create or replace function app.company_document_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = app, pg_catalog as $$
declare k text;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 14000
    or (p_doc - array['name','name_zh','summary','summary_zh','website','logo_url','email','phone','wechat','representative_card_url','country']) <> '{}'::jsonb then return false; end if;
  foreach k in array array['name','name_zh','summary','summary_zh','website','logo_url','email','phone','wechat','representative_card_url'] loop
    if not coalesce(app.company_product_text(p_doc,k,case when k in ('name','name_zh') then 160
      when k in ('summary','summary_zh') then 600 when k='email' then 254 when k='phone' then 40
      when k='wechat' then 100 when k='representative_card_url' then 200 else 2048 end),false) then return false; end if;
  end loop;
  if p_doc ? 'country' and (jsonb_typeof(p_doc->'country') is distinct from 'string' or coalesce(p_doc->>'country','')<>'' and not (p_doc->>'country'=any(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' ')))) then return false; end if;
  return app.company_product_url(p_doc->>'website') and app.company_product_url(p_doc->>'logo_url')
    and (p_doc->>'phone') ~ '^[+0-9 ()-]*$'
    and ((p_doc->>'email') = '' or (p_doc->>'email') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    and ((p_doc->>'representative_card_url') = '' or (p_doc->>'representative_card_url') ~ '^https://(www\.)?superii\.site/c/[A-Za-z0-9_-]{43}$');
end $$;

create table if not exists app.robot_engagement_counts (
  subject_id uuid primary key,
  views bigint not null default 0 check(views>=0)
);
create table if not exists app.robot_view_events (
  subject_id uuid not null,
  visitor_hash text not null check(visitor_hash ~ '^[a-f0-9]{64}$'),
  viewed_on date not null default current_date,
  primary key(subject_id,visitor_hash,viewed_on)
);
create index if not exists robot_views_retention_idx on app.robot_view_events(viewed_on);
create table if not exists app.robot_likes (
  subject_id uuid not null,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(subject_id,profile_id)
);
create table if not exists app.robot_inquiries (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  organization_id uuid not null references app.organizations(id) on delete cascade,
  sender_id uuid not null references app.profiles(id) on delete cascade,
  creation_key uuid not null,
  product_name text not null,
  topic text not null check(topic in ('general','technical','availability','partnership')),
  message text not null check(char_length(message) between 10 and 2000),
  reply_email text not null check(char_length(reply_email)<=254 and reply_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  status text not null default 'new' check(status in ('new','replied','archived')),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(sender_id,creation_key)
);
create index if not exists robot_inquiries_inbox_idx on app.robot_inquiries(organization_id,created_at desc);
create index if not exists robot_inquiries_sender_idx on app.robot_inquiries(sender_id,created_at desc);
alter table app.robot_engagement_counts enable row level security;
alter table app.robot_view_events enable row level security;
alter table app.robot_likes enable row level security;
alter table app.robot_inquiries enable row level security;
revoke all on app.robot_engagement_counts,app.robot_view_events,app.robot_likes,app.robot_inquiries from public,superii_web_backend,superii_payment_backend,superii_runtime_backend,superii_publishing_backend;

create or replace function app.robot_public_metrics(p_ids uuid[])
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
  select coalesce(jsonb_object_agg(id::text,jsonb_build_object('views',coalesce(c.views,0),'likes',(select count(*) from app.robot_likes l where l.subject_id=id))),'{}'::jsonb)
  from (select distinct unnest(p_ids) as id limit 24) ids left join app.robot_engagement_counts c on c.subject_id=id
  where app.context_is_verified()
$$;
create or replace function app.robot_engagement(p_id uuid,p_action text,p_hash text default null,p_liked boolean default null)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.current_profile_id(); added integer;
begin
  if not app.context_is_verified() or app.robot_explorer_detail(p_id) is null then raise exception 'entry_unavailable' using errcode='P0002'; end if;
  if p_action='view' then
    if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'engagement_invalid' using errcode='22023'; end if;
    insert into app.robot_view_events(subject_id,visitor_hash) values(p_id,p_hash) on conflict do nothing;
    get diagnostics added=row_count;
    if added=1 then insert into app.robot_engagement_counts(subject_id,views) values(p_id,1)
      on conflict(subject_id) do update set views=app.robot_engagement_counts.views+1; end if;
    delete from app.robot_view_events where viewed_on<current_date-31;
  elsif p_action='like' then
    if app.current_actor_kind()<>'clerk' or actor is null then raise exception 'authentication_required' using errcode='42501'; end if;
    if p_liked is null then raise exception 'engagement_invalid' using errcode='22023'; end if;
    if p_liked then insert into app.robot_likes(subject_id,profile_id) values(p_id,actor) on conflict do nothing;
    else delete from app.robot_likes where subject_id=p_id and profile_id=actor; end if;
  elsif p_action<>'read' then raise exception 'engagement_invalid' using errcode='22023'; end if;
  return (app.robot_public_metrics(array[p_id])->p_id::text)||jsonb_build_object('liked',exists(select 1 from app.robot_likes where subject_id=p_id and profile_id=actor));
end $$;

create or replace function app.robot_inquiry_destination(p_id uuid)
returns uuid language sql stable security definer set search_path=app,pg_catalog as $$
  select organization_id from (
    select p.organization_id,0 as priority from app.company_products p join app.company_pages c on c.organization_id=p.organization_id
      join app.organizations o on o.id=p.organization_id
      where p.id=p_id and p.status='published' and c.published is not null and o.is_public
    union all
    select claim.organization_id,1 from app.robot_company_claims claim join app.company_pages c on c.organization_id=claim.organization_id
      join app.organizations o on o.id=claim.organization_id
      where c.published is not null and o.is_public and (claim.reference_company_id=p_id or exists(
        select 1 from app.robot_reference_records r where r.id=p_id and r.document->'company_ids' ? claim.reference_company_id::text))
    union all
    select o.id,2 from app.organizations o join app.company_pages c on c.organization_id=o.id where o.id=p_id and o.is_public and c.published is not null
  ) destinations where app.context_is_verified() order by priority limit 1
$$;
create or replace function app.robot_contact(p_id uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
  select jsonb_build_object('available',true,'name',c.published->>'name','email',c.published->>'email','wechat',c.published->>'wechat','phone',c.published->>'phone')
  from app.company_pages c where app.context_is_verified() and c.organization_id=app.robot_inquiry_destination(p_id)
$$;
create or replace function app.send_robot_inquiry(p_id uuid,p_key uuid,p_topic text,p_message text,p_email text,p_consent boolean)
returns uuid language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.current_profile_id(); destination uuid; existing app.robot_inquiries%rowtype; card jsonb; created uuid;
begin
  if not app.context_is_verified() or app.current_actor_kind()<>'clerk' or actor is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_key is null or p_consent is distinct from true or p_topic not in ('general','technical','availability','partnership')
    or char_length(btrim(p_message)) not between 10 and 2000 or char_length(p_email)>254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'inquiry_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('robot-inquiry:'||actor::text,0));
  select * into existing from app.robot_inquiries where sender_id=actor and creation_key=p_key;
  if existing.id is not null then
    if existing.subject_id<>p_id or existing.topic<>p_topic or existing.message<>btrim(p_message) or existing.reply_email<>lower(btrim(p_email)) then raise exception 'inquiry_conflict' using errcode='23505'; end if;
    return existing.id;
  end if;
  card:=app.robot_explorer_detail(p_id);destination:=app.robot_inquiry_destination(p_id);
  if card is null or destination is null then raise exception 'inquiry_unavailable' using errcode='P0002'; end if;
  if (select count(*) from app.robot_inquiries where sender_id=actor and created_at>now()-interval '1 day')>=20 then raise exception 'inquiry_limit_reached' using errcode='23514'; end if;
  insert into app.robot_inquiries(subject_id,organization_id,sender_id,creation_key,product_name,topic,message,reply_email)
    values(p_id,destination,actor,p_key,card->>'name',p_topic,btrim(p_message),lower(btrim(p_email))) returning id into created;
  return created;
end $$;
create or replace function app.robot_inquiry_inbox(p_organization uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
begin
  if not app.can_manage_company(p_organization) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if p_offset<0 or p_offset>10000 then raise exception 'inquiry_invalid' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from app.robot_inquiries where organization_id=p_organization),
    'new',(select count(*) from app.robot_inquiries where organization_id=p_organization and status='new'),
    'items',coalesce((select jsonb_agg(item) from (select i.id,i.subject_id,i.product_name,i.topic,i.message,i.reply_email,i.status,i.created_at,
      p.display_name as sender_name,p.handle as sender_handle from app.robot_inquiries i join app.profiles p on p.id=i.sender_id
      where i.organization_id=p_organization order by i.created_at desc,i.id limit 30 offset p_offset) item),'[]'::jsonb));
end $$;
create or replace function app.set_robot_inquiry_status(p_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare org uuid;
begin
  select organization_id into org from app.robot_inquiries where id=p_id;
  if org is null or not app.can_manage_company(org) then raise exception 'company_permission_denied' using errcode='42501'; end if;
  if p_status not in ('new','replied','archived') then raise exception 'inquiry_invalid' using errcode='22023'; end if;
  update app.robot_inquiries set status=p_status where id=p_id;return true;
end $$;

do $$ declare signature text; begin
 foreach signature in array array[
  'app.robot_public_metrics(uuid[])','app.robot_engagement(uuid,text,text,boolean)',
  'app.robot_inquiry_destination(uuid)','app.robot_contact(uuid)',
  'app.send_robot_inquiry(uuid,uuid,text,text,text,boolean)','app.robot_inquiry_inbox(uuid,integer)','app.set_robot_inquiry_status(uuid,text)'
 ] loop
 execute 'revoke all on function '||signature||' from public,superii_payment_backend,superii_runtime_backend,superii_publishing_backend';
 execute 'grant execute on function '||signature||' to superii_web_backend';
 end loop;
end $$;
commit;
