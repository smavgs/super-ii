-- Free hardware classifieds, events and private member conversations.
-- All access goes through bounded functions; no backend table grants.
begin;
create table if not exists app.alien_listings (
 id uuid primary key, owner_id uuid not null references app.profiles(id) on delete cascade,
 document jsonb not null default '{}'::jsonb, version integer not null default 1,
 status text not null default 'draft' check(status in ('draft','active','sold','removed','hidden')),
 source_kind text not null default 'member' check(source_kind in ('member','official-source')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 published_at timestamptz, expires_at timestamptz
);
alter table app.alien_listings add column if not exists moderation_previous_status text;
create index if not exists alien_listings_owner on app.alien_listings(owner_id,updated_at desc);
create index if not exists alien_listings_live on app.alien_listings(status,expires_at,published_at desc);
create table if not exists app.alien_photos (
 listing_id uuid not null references app.alien_listings(id) on delete cascade,
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 primary key(listing_id,hash)
);
create table if not exists app.alien_threads (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references app.alien_listings(id) on delete cascade,
 buyer_id uuid not null references app.profiles(id) on delete cascade,
 seller_id uuid not null references app.profiles(id) on delete cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(listing_id,buyer_id), check(buyer_id<>seller_id)
);
create table if not exists app.alien_messages (
 id uuid primary key, thread_id uuid not null references app.alien_threads(id) on delete cascade,
 sender_id uuid not null references app.profiles(id) on delete cascade,
 body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now(), read_at timestamptz
);
create index if not exists alien_messages_thread on app.alien_messages(thread_id,created_at,id);
create table if not exists app.alien_blocks (
 owner_id uuid not null references app.profiles(id) on delete cascade,
 blocked_id uuid not null references app.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(owner_id,blocked_id),check(owner_id<>blocked_id)
);
create table if not exists app.alien_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null references app.profiles(id) on delete cascade,
 listing_id uuid references app.alien_listings(id) on delete cascade,
 message_id uuid references app.alien_messages(id) on delete cascade,
 reason text not null check(length(reason) between 5 and 2000),
 status text not null default 'open' check(status in ('open','resolved')), created_at timestamptz not null default now(),
 check(num_nonnulls(listing_id,message_id)=1)
);
create table if not exists app.alien_searches (
 id uuid primary key, owner_id uuid not null references app.profiles(id) on delete cascade,
 name text not null check(length(name) between 1 and 100), filters jsonb not null,
 created_at timestamptz not null default now(), unique(owner_id,filters)
);
create table if not exists app.alien_preferences (
 profile_id uuid primary key references app.profiles(id) on delete cascade,
 email text, email_enabled boolean not null default false, token uuid not null default gen_random_uuid(),
 digest_after timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists app.alien_digests (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references app.profiles(id) on delete cascade,
 since_at timestamptz not null, until_at timestamptz not null, claimed_at timestamptz not null default now(),
 sent_at timestamptz, cancelled_at timestamptz, unique(profile_id,since_at)
);

do $$ declare t text; begin
 foreach t in array array['alien_listings','alien_photos','alien_threads','alien_messages','alien_blocks','alien_reports','alien_searches','alien_preferences','alien_digests'] loop
  execute format('alter table app.%I enable row level security',t);
  execute format('revoke all on app.%I from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend',t);
 end loop;
end $$;

create or replace function app.alien_actor() returns uuid language plpgsql stable security definer set search_path=app,pg_catalog as $$
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' or app.current_actor_kind()<>'clerk' or app.current_profile_id() is null then raise exception 'alien_sign_in'; end if;
 return app.current_profile_id();
end $$;
create or replace function app.alien_is_admin() returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select app.context_is_verified() and app.current_context_service()='web' and app.current_actor_kind()='clerk' and app.context_is_admin()
$$;
create or replace function app.alien_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select exists(select 1 from app.alien_blocks where (owner_id=a and blocked_id=b) or (owner_id=b and blocked_id=a))
$$;
create or replace function app.alien_distance(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable set search_path=pg_catalog as $$
 select 6371*2*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2)))))
$$;
create or replace function app.alien_matches(d jsonb,f jsonb) returns boolean language sql immutable set search_path=app,pg_catalog as $$
 select (coalesce(f->>'kind','')='' or d->>'kind'=f->>'kind' or (f->>'kind'='hardware' and d->>'kind' in ('sale','wanted')))
 and (coalesce(f->>'category','')='' or d->>'category'=f->>'category')
 and (coalesce(f->>'q','')='' or position(lower(f->>'q') in lower(concat_ws(' ',d->>'title',d->>'description',d->'specs'))) >0)
 and (coalesce(f->>'city','')='' or position(lower(f->>'city') in lower(concat_ws(' ',d->>'city',d->>'country',d->>'area')))>0)
 and (coalesce(f->>'condition','')='' or d->>'condition'=f->>'condition')
 and (coalesce(f->>'shipping','')='' or (d->'delivery') ? (f->>'shipping'))
 and (f->>'lat' is null or (f->>'radius')::numeric=20000 or app.alien_distance((f->>'lat')::float8,(f->>'lon')::float8,(d->>'lat')::float8,(d->>'lon')::float8)<=coalesce((f->>'radius')::float8,50))
 and (f->>'max_price' is null or ((d->>'amount')::numeric <= (f->>'max_price')::numeric and d->>'currency'=f->>'currency'))
$$;
create or replace function app.alien_valid_filters(f jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(f) is distinct from 'object' or octet_length(f::text)>2000
 or exists(select 1 from jsonb_object_keys(f) k where k not in ('kind','category','q','city','condition','shipping','lat','lon','radius','max_price','currency')) then return false; end if;
 if length(coalesce(f->>'q',''))>160 or length(coalesce(f->>'city',''))>100
 or coalesce(f->>'kind','') not in ('','hardware','sale','wanted','event')
 or coalesce(f->>'category','') not in ('','gpu','mac','workstation','server','edge','robotics','storage','other','ai','robotics-event','hardware-event','makers','hackathon')
 or coalesce(f->>'condition','') not in ('','used','refurbished','open-box')
 or coalesce(f->>'shipping','') not in ('','pickup','domestic','international') then return false; end if;
 if (f->>'lat' is null)<>(f->>'lon' is null) or (f->>'lat' is not null and ((f->>'lat')::numeric not between -90 and 90 or (f->>'lon')::numeric not between -180 and 180))
 or (f->>'radius' is not null and (f->>'radius')::numeric not between 1 and 20000)
 or (f->>'max_price' is not null and ((f->>'max_price')::numeric not between 0 and 1000000000 or coalesce(f->>'currency','') !~ '^[A-Z]{3}$')) then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function app.alien_valid_document(d jsonb,ready boolean) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare x jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>20000
 or exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','category','condition','amount','currency','negotiable','delivery','city','country','area','lat','lon','specs','photos','original_photos','business','all_day','starts_at','ends_at','timezone','registration_url','organizer','source_url'))
 or coalesce(d->>'kind','') not in ('sale','wanted','event')
 or jsonb_typeof(d->'title') is distinct from 'string' or length(d->>'title')>120
 or jsonb_typeof(d->'description') is distinct from 'string' or length(d->>'description')>6000
 or jsonb_typeof(d->'photos') is distinct from 'array' or jsonb_array_length(d->'photos')>8
 or jsonb_typeof(d->'specs') is distinct from 'object' or octet_length((d->'specs')::text)>1500
 or jsonb_typeof(d->'delivery') is distinct from 'array' or jsonb_array_length(d->'delivery')>3
 or coalesce(d->>'category','') not in ('','gpu','mac','workstation','server','edge','robotics','storage','other','ai','robotics-event','hardware-event','makers','hackathon')
 or coalesce(d->>'condition','') not in ('','used','refurbished','open-box')
 or coalesce(d->>'currency','') !~ '^[A-Z]{3}$'
 or jsonb_typeof(d->'negotiable') is distinct from 'boolean' or jsonb_typeof(d->'business') is distinct from 'boolean'
 or jsonb_typeof(d->'original_photos') is distinct from 'boolean' or jsonb_typeof(d->'all_day') is distinct from 'boolean'
 or length(coalesce(d->>'city',''))>100 or length(coalesce(d->>'area',''))>100 or coalesce(d->>'country','') !~ '^([A-Z]{2})?$'
 or length(coalesce(d->>'organizer',''))>160 or length(coalesce(d->>'timezone',''))>80 then return false; end if;
 for x in select * from jsonb_array_elements(d->'photos') loop if jsonb_typeof(x) is distinct from 'string' or (x#>>'{}') !~ '^[a-f0-9]{64}$' then return false; end if; end loop;
 if (select count(distinct v) from jsonb_array_elements(d->'photos') v)<>jsonb_array_length(d->'photos') then return false; end if;
 for x in select * from jsonb_array_elements(d->'delivery') loop if (x#>>'{}') not in ('pickup','domestic','international') then return false; end if; end loop;
 if exists(select 1 from jsonb_each(d->'specs') s where s.key not in ('brand','model','ram','vram','chip','storage') or jsonb_typeof(s.value)<>'string' or length(s.value#>>'{}')>160) then return false; end if;
 if d->>'lat' is not null and ((d->>'lat')::numeric not between -90 and 90 or (d->>'lon')::numeric not between -180 and 180) then return false; end if;
 if (d->>'lat' is null)<>(d->>'lon' is null) or (d->>'amount' is not null and (d->>'amount')::numeric not between 0 and 1000000000) then return false; end if;
 if coalesce(d->>'registration_url','')<>'' and (d->>'registration_url' !~ '^https://[^/@[:space:]]+(/|$)' or length(d->>'registration_url')>2048) then return false; end if;
 if coalesce(d->>'source_url','')<>'' and (d->>'source_url' !~ '^https://[^/@[:space:]]+(/|$)' or length(d->>'source_url')>2048) then return false; end if;
 if not ready then return true; end if;
 if length(trim(d->>'title'))<6 or length(trim(d->>'description'))<20 or length(trim(coalesce(d->>'city','')))<2 or length(d->>'country')<>2 or d->>'lat' is null or d->>'category'='' then return false; end if;
 if d->>'kind'='event' then
  return d->>'category' in ('ai','robotics-event','hardware-event','makers','hackathon') and length(coalesce(d->>'organizer',''))>0
   and d->>'starts_at' is not null and d->>'ends_at' is not null and (d->>'ends_at')::timestamptz>(d->>'starts_at')::timestamptz
   and (d->>'ends_at')::timestamptz<(d->>'starts_at')::timestamptz+interval '31 days'
   and coalesce(d->>'registration_url','')<>'' and length(coalesce(d->>'timezone',''))>0
   and ((d->>'country'='US' and lower(d->>'city')='san francisco' and d->>'timezone'='America/Los_Angeles') or (d->>'country'='CN' and lower(d->>'city')='shenzhen' and d->>'timezone'='Asia/Shanghai'));
 end if;
 return d->>'category' in ('gpu','mac','workstation','server','edge','robotics','storage','other') and jsonb_array_length(d->'delivery')>0
  and (d->>'kind'='wanted' or (d->>'condition' in ('used','refurbished','open-box') and d->>'amount' is not null and jsonb_array_length(d->'photos')>=2 and (d->>'original_photos')::boolean));
exception when others then return false;
end $$;

create or replace function app.alien_listing_json(l app.alien_listings) returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object('id',l.id,'document',l.document,'status',case when l.status='active' and l.expires_at<=now() then 'expired' else l.status end,
 'source_kind',l.source_kind,'published_at',l.published_at,'expires_at',l.expires_at,'version',l.version,'updated_at',l.updated_at,
 'seller',jsonb_build_object('id',p.id,'handle',p.handle,'name',p.display_name,'joined_at',p.created_at),
 'owned',app.current_actor_kind()='clerk' and l.owner_id=app.current_profile_id()) from app.profiles p where p.id=l.owner_id
$$;
create or replace function app.alien_browse(f jsonb default '{}'::jsonb,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare result jsonb;
begin
 if not app.alien_valid_filters(f) or p_page not between 0 and 200 then raise exception 'alien_invalid'; end if;
 with matches as materialized(select * from app.alien_listings l where status='active' and expires_at>now() and app.alien_matches(l.document,f)),
 chosen as(select * from matches order by case when document->>'kind'='event' then (document->>'starts_at')::timestamptz end asc,published_at desc,id limit 24 offset p_page*24)
 select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'size',24,'items',coalesce((select jsonb_agg(app.alien_listing_json(chosen)) from chosen),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function app.alien_detail(p_id uuid) returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select app.alien_listing_json(l) from app.alien_listings l where l.id=p_id and
 ((l.status in ('active','sold') and l.published_at is not null) or (app.current_actor_kind()='clerk' and l.owner_id=app.current_profile_id()) or app.alien_is_admin())
$$;

create or replace function app.alien_save_listing(p_id uuid,p_version integer,p_action text,d jsonb)
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor(); l app.alien_listings; fresh boolean; s app.alien_searches; quota integer;
begin
 if p_action not in ('save','publish','renew','sold','remove') then raise exception 'alien_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,49));
 select * into l from app.alien_listings where id=p_id for update;
 fresh:=not found;
 if not fresh and l.owner_id<>actor then raise exception 'alien_not_allowed'; end if;
 if (fresh and p_version<>0) or (not fresh and p_version<>l.version) then raise exception 'alien_conflict'; end if;
 if not fresh and l.status='hidden' then raise exception 'alien_hidden'; end if;
 if p_action in ('renew','sold','remove') and fresh then raise exception 'alien_not_found'; end if;
 if p_action in ('renew','sold') and l.published_at is null then raise exception 'alien_invalid'; end if;
 if p_action in ('save','publish') then
  if not app.alien_valid_document(d,p_action='publish' or (not fresh and l.status='active')) then raise exception 'alien_invalid'; end if;
  -- Round before persistence. Never keep the caller's exact coordinates.
  if d->>'lat' is not null then d:=d||jsonb_build_object('lat',round((d->>'lat')::numeric*50)/50,'lon',round((d->>'lon')::numeric*50)/50); end if;
  if exists(select 1 from jsonb_array_elements_text(d->'photos') h where not exists(select 1 from app.alien_photos where listing_id=p_id and hash=h)) then raise exception 'alien_photo_missing'; end if;
  if not fresh and l.published_at is not null and d->>'kind'<>l.document->>'kind' then raise exception 'alien_kind_fixed'; end if;
 else d:=l.document; end if;
 if fresh and (select count(*) from app.alien_listings where owner_id=actor and (status='draft' or created_at>now()-interval '24 hours'))>=20 then raise exception 'alien_limit'; end if;
 if p_action='publish' and (fresh or l.published_at is null) then
  select case when created_at>now()-interval '7 days' then 3 else 15 end into quota from app.profiles where id=actor;
  if (select count(*) from app.alien_listings where owner_id=actor and published_at>now()-interval '24 hours')>=quota then raise exception 'alien_limit'; end if;
 end if;
 if p_action in ('publish','renew') or (p_action='save' and not fresh and l.status='active') then
  if not app.alien_valid_document(d,true) then raise exception 'alien_invalid'; end if;
  if d->>'kind'='event' and (d->>'ends_at')::timestamptz<=now() then raise exception 'alien_event_ended'; end if;
  -- Serialize event publication across owners, including edits to active events.
  if d->>'kind'='event' then perform pg_advisory_xact_lock(490050); end if;
  if exists(select 1 from app.alien_listings where id<>p_id and status='active' and expires_at>now() and
    ((d->>'kind'='event' and document->>'kind'='event' and (document->>'registration_url'=d->>'registration_url' or (lower(document->>'title')=lower(d->>'title') and document->>'starts_at'=d->>'starts_at')))
     or (owner_id=actor and lower(document->>'title')=lower(d->>'title')))) then raise exception 'alien_duplicate'; end if;
 end if;
 if fresh then insert into app.alien_listings(id,owner_id,document) values(p_id,actor,d) returning * into l; end if;
 update app.alien_listings set document=d,version=case when fresh then 1 else version+1 end,updated_at=now(),
  status=case p_action when 'publish' then 'active' when 'renew' then 'active' when 'sold' then 'sold' when 'remove' then 'removed' else status end,
  published_at=case when p_action in ('publish','renew') then coalesce(published_at,now()) else published_at end,
  expires_at=case when p_action in ('publish','renew') then case when d->>'kind'='event' then (d->>'ends_at')::timestamptz else now()+interval '30 days' end when p_action='save' and status='active' and d->>'kind'='event' then (d->>'ends_at')::timestamptz else expires_at end
 where id=p_id returning * into l;
 if p_action in ('publish','renew') then
  update app.notifications set needs_action=false where resource_type='alien-listing' and resource_id=p_id;
  for s in select * from app.alien_searches where owner_id<>actor and app.alien_matches(d,filters) loop
   perform app.enqueue_member_notification(s.owner_id,'alien-match:'||s.id||':'||p_id,'aliens.match','A listing matches your saved search',s.name,'/aliens-list/'||p_id,null,null,false);
  end loop;
 end if;
 return app.alien_listing_json(l);
end $$;
create or replace function app.alien_photo(p_id uuid,p_hash text,p_action text default 'read') returns boolean language plpgsql security definer set search_path=app,pg_catalog as $$
declare l app.alien_listings;
begin
 if p_hash !~ '^[a-f0-9]{64}$' or p_action not in ('read','check','add') then return false; end if;
 select * into l from app.alien_listings where id=p_id;
 if not found then return false; end if;
 if p_action='read' then return exists(select 1 from app.alien_photos where listing_id=p_id and hash=p_hash) and
 ((l.status in ('active','sold') and (l.document->'photos') ? p_hash) or (app.current_actor_kind()='clerk' and l.owner_id=app.current_profile_id()) or app.alien_is_admin()); end if;
 if l.owner_id<>app.alien_actor() or l.status='hidden' then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,49));
 if not exists(select 1 from app.alien_photos where listing_id=p_id and hash=p_hash) and (select count(*) from app.alien_photos where listing_id=p_id)>=24 then raise exception 'alien_photo_limit'; end if;
 if p_action='add' then insert into app.alien_photos values(p_id,p_hash,now()) on conflict do nothing; end if;
 return true;
end $$;

create or replace function app.alien_message(p_message uuid,p_listing uuid,p_thread uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor(); t app.alien_threads; l app.alien_listings; m app.alien_messages; other uuid; quota integer;
begin
 p_body:=trim(p_body);
 if length(p_body) not between 1 and 4000 then raise exception 'alien_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,50));
 select * into m from app.alien_messages where id=p_message;
 if found then
  if m.sender_id<>actor or m.body<>p_body or (p_thread is not null and m.thread_id<>p_thread) or (p_thread is null and not exists(select 1 from app.alien_threads where id=m.thread_id and listing_id=p_listing)) then raise exception 'alien_conflict'; end if;
  return jsonb_build_object('thread_id',m.thread_id,'message_id',m.id);
 end if;
 if p_thread is null then
  select * into l from app.alien_listings where id=p_listing and status='active' and expires_at>now();
  if not found then raise exception 'alien_not_available'; end if;
  if l.owner_id=actor then raise exception 'alien_own_listing'; end if;
  select * into t from app.alien_threads where listing_id=p_listing and buyer_id=actor;
  if not found then
   select case when created_at>now()-interval '7 days' then 5 else 25 end into quota from app.profiles where id=actor;
   if (select count(*) from app.alien_threads where buyer_id=actor and created_at>now()-interval '24 hours')>=quota then raise exception 'alien_limit'; end if;
   insert into app.alien_threads(listing_id,buyer_id,seller_id) values(p_listing,actor,l.owner_id) returning * into t;
  end if;
 else select * into t from app.alien_threads where id=p_thread and actor in (buyer_id,seller_id); if not found then raise exception 'alien_not_found'; end if; end if;
 other:=case when actor=t.buyer_id then t.seller_id else t.buyer_id end;
 if app.alien_blocked(actor,other) then raise exception 'alien_blocked'; end if;
 if (select count(*) from app.alien_messages where sender_id=actor and created_at>now()-interval '1 hour')>=60 then raise exception 'alien_limit'; end if;
 insert into app.alien_messages(id,thread_id,sender_id,body) values(p_message,t.id,actor,p_body);
 update app.alien_threads set updated_at=now() where id=t.id;
 perform app.enqueue_member_notification(other,'alien-message:'||p_message,'aliens.message','New Aliens List message','Open your private conversation to reply.','/aliens-list/mine?tab=messages&thread='||t.id,'alien-thread',t.id,true);
 return jsonb_build_object('thread_id',t.id,'message_id',p_message);
end $$;
drop function if exists app.alien_thread(uuid,timestamptz);
create or replace function app.alien_thread(p_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor(); t app.alien_threads; result jsonb;
begin
 select * into t from app.alien_threads where id=p_id and actor in (buyer_id,seller_id);
 if not found then return null; end if;
 select jsonb_build_object('id',t.id,'listing_id',t.listing_id,'title',l.document->>'title','other',jsonb_build_object('id',p.id,'handle',p.handle,'name',p.display_name),
 'blocked',app.alien_blocked(actor,p.id),'blocked_by_me',exists(select 1 from app.alien_blocks where owner_id=actor and blocked_id=p.id),
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'mine',m.sender_id=actor,'created_at',m.created_at,'read_at',m.read_at) order by m.created_at,m.id)
 from (select * from app.alien_messages where thread_id=p_id and (p_before is null or (created_at,id)<(p_before,coalesce(p_before_id,'00000000-0000-0000-0000-000000000000'::uuid))) order by created_at desc,id desc limit 100) m),'[]'::jsonb)) into result
 from app.alien_listings l,app.profiles p where l.id=t.listing_id and p.id=case when actor=t.buyer_id then t.seller_id else t.buyer_id end;
 return result;
end $$;
create or replace function app.alien_mark_read(p_id uuid,p_through timestamptz) returns void language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor();
begin
 if not exists(select 1 from app.alien_threads where id=p_id and actor in (buyer_id,seller_id)) then raise exception 'alien_not_found'; end if;
 update app.alien_messages set read_at=coalesce(read_at,now()) where thread_id=p_id and sender_id<>actor and created_at<=p_through;
 update app.notifications set needs_action=false,read_at=coalesce(read_at,now()) where profile_id=actor and resource_type='alien-thread' and resource_id=p_id and created_at<=p_through;
end $$;
create or replace function app.alien_block(p_other uuid,p_active boolean) returns void language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor();
begin
 if actor=p_other or not exists(select 1 from app.alien_threads where (buyer_id=actor and seller_id=p_other) or (seller_id=actor and buyer_id=p_other)) then raise exception 'alien_not_found'; end if;
 if p_active then insert into app.alien_blocks(owner_id,blocked_id) values(actor,p_other) on conflict do nothing;
 else delete from app.alien_blocks where owner_id=actor and blocked_id=p_other; end if;
end $$;
create or replace function app.alien_report(p_listing uuid,p_message uuid,p_reason text) returns uuid language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor(); rid uuid;
begin
 if num_nonnulls(p_listing,p_message)<>1 or length(trim(p_reason)) not between 5 and 2000 then raise exception 'alien_invalid'; end if;
 if p_listing is not null and app.alien_detail(p_listing) is null then raise exception 'alien_not_found'; end if;
 if p_message is not null and not exists(select 1 from app.alien_messages m join app.alien_threads t on t.id=m.thread_id where m.id=p_message and actor in (t.buyer_id,t.seller_id)) then raise exception 'alien_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,51));
 select id into rid from app.alien_reports where reporter_id=actor and status='open' and (listing_id=p_listing or message_id=p_message);
 if rid is not null then return rid; end if;
 if (select count(*) from app.alien_reports where reporter_id=actor and created_at>now()-interval '24 hours')>=20 then raise exception 'alien_limit'; end if;
 insert into app.alien_reports(reporter_id,listing_id,message_id,reason) values(actor,p_listing,p_message,trim(p_reason)) returning id into rid;
 return rid;
end $$;
create or replace function app.alien_save_search(p_id uuid,p_name text,f jsonb,p_delete boolean default false) returns uuid language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor(); result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,52));
 if exists(select 1 from app.alien_searches where id=p_id and owner_id<>actor) then raise exception 'alien_not_allowed'; end if;
 if p_delete then delete from app.alien_searches where id=p_id and owner_id=actor; return p_id; end if;
 if not app.alien_valid_filters(f) or length(trim(p_name)) not between 1 and 100 then raise exception 'alien_invalid'; end if;
 if (select count(*) from app.alien_searches where owner_id=actor)>=20 and not exists(select 1 from app.alien_searches where owner_id=actor and (id=p_id or filters=f)) then raise exception 'alien_limit'; end if;
 select id into result from app.alien_searches where owner_id=actor and filters=f;
 if result is not null then return result; end if;
 insert into app.alien_searches(id,owner_id,name,filters) values(p_id,actor,trim(p_name),f)
 on conflict(id) do update set name=excluded.name,filters=excluded.filters;
 return p_id;
end $$;
drop function if exists app.alien_mine();
create or replace function app.alien_mine(p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor();
begin
 if p_page not between 0 and 200 then raise exception 'alien_invalid'; end if;
 return jsonb_build_object('profile_id',actor,'admin',app.alien_is_admin(),'page',p_page,'size',25,
 'listings_total',(select count(*) from app.alien_listings where owner_id=actor),
 'threads_total',(select count(*) from app.alien_threads where actor in (buyer_id,seller_id)),
 'unread_total',(select count(*) from app.alien_messages m join app.alien_threads t on t.id=m.thread_id where actor in(t.buyer_id,t.seller_id) and m.sender_id<>actor and m.read_at is null),
 'listings',coalesce((select jsonb_agg(app.alien_listing_json(l) order by l.updated_at desc) from (select * from app.alien_listings where owner_id=actor order by updated_at desc,id limit 25 offset p_page*25) l),'[]'::jsonb),
 'threads',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'listing_id',t.listing_id,'title',l.document->>'title','other',p.handle,'updated_at',t.updated_at,
 'unread',(select count(*) from app.alien_messages where thread_id=t.id and sender_id<>actor and read_at is null)) order by t.updated_at desc)
 from (select * from app.alien_threads where actor in (buyer_id,seller_id) order by updated_at desc,id limit 25 offset p_page*25) t join app.alien_listings l on l.id=t.listing_id join app.profiles p on p.id=case when actor=t.buyer_id then t.seller_id else t.buyer_id end where actor in (t.buyer_id,t.seller_id)),'[]'::jsonb),
 'searches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'filters',filters) order by created_at desc) from app.alien_searches where owner_id=actor),'[]'::jsonb),
 'email_enabled',coalesce((select email_enabled from app.alien_preferences where profile_id=actor),false));
end $$;
create or replace function app.alien_moderate(p_report uuid default null,p_action text default 'list') returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare report_row app.alien_reports; hidden_listing app.alien_listings;
begin
 if not app.alien_is_admin() then raise exception 'alien_not_allowed'; end if;
 if p_action='list' then return coalesce((select jsonb_agg(x) from (select r.id,r.reason,r.created_at,r.listing_id,r.message_id,
  r.status,l.status listing_status,l.document->>'title' title,m.body reported_message,p.handle reporter from app.alien_reports r left join app.alien_listings l on l.id=r.listing_id
  left join app.alien_messages m on m.id=r.message_id join app.profiles p on p.id=r.reporter_id where r.status='open' or l.status='hidden' order by r.created_at limit 100) x),'[]'::jsonb); end if;
 if p_action not in ('resolve','hide','restore') then raise exception 'alien_invalid'; end if;
 select * into report_row from app.alien_reports where id=p_report for update;
 if not found then raise exception 'alien_not_found'; end if;
 if p_action in ('hide','restore') then
  if report_row.listing_id is null then raise exception 'alien_invalid'; end if;
  update app.alien_listings set moderation_previous_status=case when p_action='hide' then status else null end,
   status=case when p_action='restore' then coalesce(moderation_previous_status,'active') else 'hidden' end,
   version=version+1,updated_at=now() where id=report_row.listing_id
   and ((p_action='hide' and status<>'hidden') or (p_action='restore' and status='hidden')) returning * into hidden_listing;
  if not found then return jsonb_build_object('ok',true); end if;
  perform app.enqueue_member_notification(hidden_listing.owner_id,'alien-moderation:'||report_row.id||':'||p_action,'aliens.moderation',case when p_action='restore' then 'Your listing has been restored' else 'A listing has been hidden' end,'Open My listings for details. Contact Super ii if you need help.','/aliens-list/mine','alien-listing',hidden_listing.id,true);
 end if;
 update app.alien_reports set status='resolved' where id=p_report;
 return jsonb_build_object('ok',true);
end $$;

create or replace function app.alien_set_email(p_enabled boolean,p_email text default null) returns void language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.alien_actor();
begin
 if p_enabled and (p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'alien_invalid'; end if;
 insert into app.alien_preferences(profile_id,email,email_enabled) values(actor,case when p_enabled then p_email end,p_enabled)
 on conflict(profile_id) do update set email=excluded.email,email_enabled=excluded.email_enabled,digest_after=case when not app.alien_preferences.email_enabled and excluded.email_enabled then now() else app.alien_preferences.digest_after end,token=case when not app.alien_preferences.email_enabled and excluded.email_enabled then gen_random_uuid() else app.alien_preferences.token end,updated_at=now();
 if not p_enabled then update app.alien_digests set cancelled_at=now() where profile_id=actor and sent_at is null; end if;
end $$;
create or replace function app.alien_unsubscribe(p_profile uuid,p_token uuid) returns boolean language plpgsql security definer set search_path=app,pg_catalog as $$
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then return false; end if;
 update app.alien_preferences set email_enabled=false,email=null,updated_at=now() where profile_id=p_profile and token=p_token;
 if not found then return false; end if;
 update app.alien_digests set cancelled_at=now() where profile_id=p_profile and sent_at is null;
 return true;
end $$;
-- Internal scheduled worker only. No HTTP endpoint exposes digest addresses.
create or replace function app.alien_maintenance() returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare l app.alien_listings; pref app.alien_preferences; dg app.alien_digests; result jsonb:='[]'::jsonb;
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then raise exception 'alien_not_allowed'; end if;
 if not pg_try_advisory_xact_lock(490049) then return result; end if;
 for l in select * from app.alien_listings where status='active' and document->>'kind'<>'event' and expires_at<now()+interval '3 days' and expires_at>now()-interval '7 days' loop
  perform app.enqueue_member_notification(l.owner_id,'alien-expiry:'||l.id||':'||l.expires_at,'aliens.expiry',case when l.expires_at<=now() then 'Your listing has expired' else 'Your listing expires soon' end,l.document->>'title','/aliens-list/mine','alien-listing',l.id,true);
 end loop;
 -- Retry incomplete sends with the same provider idempotency key for at most 23h.
 with expired as (update app.alien_digests set cancelled_at=now() where sent_at is null and cancelled_at is null and until_at<now()-interval '23 hours' returning profile_id,until_at) update app.alien_preferences p set digest_after=greatest(p.digest_after,e.until_at) from expired e where p.profile_id=e.profile_id;
 for pref in select * from app.alien_preferences p where email_enabled and email is not null and digest_after<now()-interval '24 hours'
  and exists(select 1 from app.notifications n where n.profile_id=p.profile_id and n.event_type like 'aliens.%' and n.created_at>p.digest_after and n.read_at is null)
  order by digest_after limit 50 loop
  insert into app.alien_digests(profile_id,since_at,until_at) values(pref.profile_id,pref.digest_after,now()) on conflict do nothing;
 end loop;
 for dg in select d.* from app.alien_digests d join app.alien_preferences p on p.profile_id=d.profile_id and p.email_enabled
  where d.sent_at is null and d.cancelled_at is null and (d.claimed_at<=now()-interval '15 minutes' or d.claimed_at=now()) order by d.until_at limit 50 for update of d skip locked loop
  update app.alien_digests set claimed_at=now() where id=dg.id;
  select * into pref from app.alien_preferences where profile_id=dg.profile_id;
  result:=result||jsonb_build_array(jsonb_build_object('id',dg.id,'profile_id',pref.profile_id,'email',pref.email,'token',pref.token));
 end loop;
 return result;
end $$;
create or replace function app.alien_digest_sent(p_id uuid) returns void language plpgsql security definer set search_path=app,pg_catalog as $$
declare d app.alien_digests;
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then raise exception 'alien_not_allowed'; end if;
 update app.alien_digests set sent_at=coalesce(sent_at,now()) where id=p_id and cancelled_at is null returning * into d;
 if found then update app.alien_preferences set digest_after=greatest(digest_after,d.until_at) where profile_id=d.profile_id; end if;
end $$;

create or replace function app.notification_resource_visible(p_type text,p_id uuid)
returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select case when p_type is null then true
 when p_type='repository' then app.can_access_repository(p_id,false)
 when p_type='organization' then app.can_access_organization(p_id,false)
 when p_type='company' then app.can_manage_company(p_id)
 when p_type='workroom' then app.can_access_workroom(p_id)
 when p_type='social' then exists(select 1 from app.social_agents where id=p_id and owner_profile_id=app.current_profile_id())
 when p_type='alien-listing' then exists(select 1 from app.alien_listings where id=p_id and owner_id=app.current_profile_id())
 when p_type='alien-thread' then exists(select 1 from app.alien_threads where id=p_id and app.current_profile_id() in (buyer_id,seller_id))
 else false end
$$;
-- Restrict every new helper, including functions intended only for other functions.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname like 'alien_%' loop
  execute format('revoke all on function %s from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend',f.signature);
  if f.name in ('alien_browse','alien_detail','alien_save_listing','alien_photo','alien_message','alien_thread','alien_mark_read','alien_block','alien_report','alien_save_search','alien_mine','alien_moderate','alien_set_email','alien_unsubscribe','alien_maintenance','alien_digest_sent') then
   execute format('grant execute on function %s to superii_web_backend',f.signature);
  end if;
 end loop;
end $$;
commit;
