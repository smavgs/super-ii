-- Sigma is an editorial layer over Posts; Papers keep their existing records.
begin;
create table if not exists app.sigma_editors (
 profile_id uuid primary key references app.profiles(id) on delete cascade,
 granted_by uuid references app.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists app.sigma_stories (
 id uuid primary key references app.posts(id) on delete cascade,
 draft jsonb not null,
 published jsonb,
 status text not null default 'draft' check(status in ('draft','submitted','published')),
 version integer not null default 1,
 published_at timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists app.sigma_subscribers (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(length(email)<=254),
 locale text not null check(locale in ('en','ru','zh-CN')),
 status text not null default 'pending' check(status in ('pending','active','unsubscribed')),
 confirmation_nonce uuid not null default gen_random_uuid(),
 token_version uuid not null default gen_random_uuid(),
 requested_at timestamptz not null default now(),
 confirmed_at timestamptz,
 unsubscribed_at timestamptz,
 consent_version text not null default 'sigma-daily-v1'
);
create table if not exists app.sigma_editions (
 id uuid primary key,
 created_by uuid not null references app.profiles(id),
 stories jsonb not null,
 created_at timestamptz not null default now(),
 started_at timestamptz
);
create table if not exists app.sigma_deliveries (
 id uuid primary key default gen_random_uuid(),
 edition_id uuid not null references app.sigma_editions(id) on delete cascade,
 subscriber_id uuid not null references app.sigma_subscribers(id) on delete cascade,
 locale text not null,
 token_version uuid not null,
 status text not null default 'queued' check(status in ('queued','sending','sent','failed','skipped')),
 first_attempt_at timestamptz,
 claimed_at timestamptz,
 provider_id text,
 unique(edition_id,subscriber_id)
);
create index if not exists sigma_deliveries_queue on app.sigma_deliveries(edition_id,status,claimed_at);
alter table app.sigma_editors enable row level security;
alter table app.sigma_stories enable row level security;
alter table app.sigma_subscribers enable row level security;
alter table app.sigma_editions enable row level security;
alter table app.sigma_deliveries enable row level security;
-- No table grants: public functions expose only publication snapshots, never drafts or emails.
revoke all on app.sigma_editors,app.sigma_stories,app.sigma_subscribers,app.sigma_editions,app.sigma_deliveries
 from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;

create or replace function app.sigma_is_editor()
returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select app.current_actor_kind()='clerk' and app.current_profile_id() is not null
 and (app.context_is_admin() or exists(select 1 from app.sigma_editors where profile_id=app.current_profile_id()))
$$;
create or replace function app.sigma_access()
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object('profile_id',app.current_profile_id(),'editor',coalesce(app.sigma_is_editor(),false),'admin',app.context_is_admin() and app.current_actor_kind()='clerk')
$$;
create or replace function app.sigma_set_editor(p_handle text,p_enabled boolean)
returns void language plpgsql security definer set search_path=app,pg_catalog as $$
declare target uuid;
begin
 if not app.sigma_is_editor() or not app.context_is_admin() then raise exception 'sigma_admin_required'; end if;
 select id into target from app.profiles where lower(handle)=lower(p_handle);
 if target is null then raise exception 'sigma_profile_not_found'; end if;
 if p_enabled then insert into app.sigma_editors(profile_id,granted_by) values(target,app.current_profile_id()) on conflict do nothing;
 else delete from app.sigma_editors where profile_id=target; end if;
end $$;
create or replace function app.sigma_valid_document(d jsonb,p_ready boolean)
returns boolean language plpgsql immutable set search_path=app,pg_catalog as $$
declare t jsonb; item jsonb; k text;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>300000
 or coalesce(d->>'source_language','') not in ('en','ru','zh-CN')
 or coalesce(d->>'category','') not in ('models','research','agents','robotics','hardware','community')
 or jsonb_typeof(d->'translations') is distinct from 'object'
 or jsonb_typeof(d->'sources') is distinct from 'array'
 or jsonb_typeof(d->'images') is distinct from 'array'
 or jsonb_typeof(d->'rights_confirmed') is distinct from 'boolean'
 or jsonb_array_length(d->'sources')>8 or jsonb_array_length(d->'images')>2
 or not (d->'translations' ? (d->>'source_language')) then return false; end if;
 for k,t in select * from jsonb_each(d->'translations') loop
  if k not in ('en','ru','zh-CN') or jsonb_typeof(t) is distinct from 'object'
  or jsonb_typeof(t->'title') is distinct from 'string' or length(t->>'title') not between 3 and 300
  or jsonb_typeof(t->'summary') is distinct from 'string' or length(t->>'summary')>500
  or jsonb_typeof(t->'body') is distinct from 'string' or length(t->>'body') not between 1 and 30000 then return false; end if;
 end loop;
 for item in select * from jsonb_array_elements(d->'sources') loop
  if coalesce(item->>'url','') !~ '^https://[^/@[:space:]]+/' or length(item->>'url')>2048
  or length(coalesce(item->>'label','')) not between 1 and 160 then return false; end if;
 end loop;
 for item in select * from jsonb_array_elements(d->'images') loop
  if coalesce(item->>'url','') !~ '^/api/sigma/media/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
  or length(coalesce(item->>'alt','')) not between 1 and 300
  or length(coalesce(item->>'credit','')) not between 1 and 300
  or coalesce(item->>'source_url','') !~ '^https://[^/@[:space:]]+/' then return false; end if;
 end loop;
 return not p_ready or ((d->>'rights_confirmed')::boolean and jsonb_array_length(d->'sources')>0);
end $$;
create or replace function app.sigma_save_story(p_id uuid,p_version integer,p_slug text,p_action text,p_document jsonb)
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare s app.sigma_stories; p app.posts; author uuid:=app.current_profile_id(); t jsonb; is_new boolean;
begin
 if author is null or app.current_actor_kind()<>'clerk' then raise exception 'sigma_sign_in_required'; end if;
 if p_action not in ('save','submit','publish','unpublish','delete') or not app.sigma_valid_document(p_document,p_action in ('submit','publish'))
 or p_slug !~ '^[a-z0-9]([a-z0-9-]{0,94}[a-z0-9])?$' then raise exception 'sigma_invalid_story'; end if;
 if p_action='publish' and not app.sigma_is_editor() then raise exception 'sigma_editor_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,46));
 select * into s from app.sigma_stories where id=p_id for update;
 is_new:=not found;
 if is_new then
  if p_version<>0 or p_action in ('unpublish','delete') then raise exception 'sigma_version_conflict'; end if;
  if (select count(*) from app.sigma_stories existing join app.posts post on post.id=existing.id where post.author_profile_id=author and existing.published is null)>=100 then raise exception 'sigma_draft_limit'; end if;
  t:=p_document->'translations'->(p_document->>'source_language');
  insert into app.posts(id,author_profile_id,slug,title,summary,body,is_public)
   values(p_id,author,p_slug,t->>'title',t->>'summary',t->>'body',false) returning * into p;
  insert into app.sigma_stories(id,draft) values(p_id,p_document) returning * into s;
 else
  select * into p from app.posts where id=p_id for update;
  if p.author_profile_id<>author and not app.sigma_is_editor() then raise exception 'sigma_not_allowed'; end if;
  if p_version<>s.version then raise exception 'sigma_version_conflict'; end if;
  if p_slug<>p.slug then raise exception 'sigma_address_is_permanent'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_document->'images') image where image->>'url' not like '/api/sigma/media/'||p_id::text||'/%') then raise exception 'sigma_image_owner_mismatch'; end if;
 if p_action='delete' then
  if s.published is not null then raise exception 'sigma_unpublish_first'; end if;
  delete from app.posts where id=p_id;
  return jsonb_build_object('id',p_id,'deleted',true);
 end if;
 if p_action='publish' then
  if not exists(select 1 from app.profiles where id=p.author_profile_id and is_public) then raise exception 'sigma_public_profile_required'; end if;
  t:=p_document->'translations'->(p_document->>'source_language');
  update app.posts set title=t->>'title',summary=t->>'summary',body=t->>'body',is_public=true,
   published_at=coalesce(s.published_at,now()),updated_at=now() where id=p_id;
  update app.sigma_stories set published=p_document,published_at=coalesce(published_at,now()) where id=p_id;
  if s.published_at is null then
   insert into app.activity_events(actor_profile_id,event_type,metadata) values(p.author_profile_id,'post.published',jsonb_build_object('post_id',p_id,'slug',p_slug,'title',t->>'title'));
  end if;
 elsif p_action='unpublish' then
  update app.posts set is_public=false where id=p_id;
  update app.sigma_stories set published=null where id=p_id;
 end if;
 update app.sigma_stories set draft=p_document,version=case when is_new then 1 else version+1 end,
  status=case p_action when 'publish' then 'published' when 'submit' then 'submitted' else 'draft' end,updated_at=now()
 where id=p_id returning * into s;
 return jsonb_build_object('id',s.id,'version',s.version,'status',s.status,'slug',p.slug,'href','/sigma/'||(select handle from app.profiles where id=p.author_profile_id)||'/'||p.slug);
end $$;
create or replace function app.sigma_drafts(p_id uuid default null)
returns table(id uuid,slug text,owner text,status text,version integer,document jsonb,published_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=app,pg_catalog as $$
 select s.id,p.slug,profile.handle::text,s.status,s.version,s.draft,s.published_at,s.updated_at
 from app.sigma_stories s join app.posts p on p.id=s.id join app.profiles profile on profile.id=p.author_profile_id
 where app.current_actor_kind()='clerk' and (p.author_profile_id=app.current_profile_id() or app.sigma_is_editor())
 and (p_id is null or s.id=p_id) order by s.updated_at desc limit 100
$$;
create or replace function app.sigma_public_stories(p_query text default '',p_offset integer default 0,p_limit integer default 5)
returns table(id uuid,slug text,owner text,owner_name text,published_at timestamptz,document jsonb)
language sql stable security definer set search_path=app,pg_catalog as $$
 select s.id,p.slug,profile.handle::text,profile.display_name,s.published_at,s.published
 from app.sigma_stories s join app.posts p on p.id=s.id and p.is_public join app.profiles profile on profile.id=p.author_profile_id and profile.is_public
 where s.published is not null and (p_query='' or position(lower(left(p_query,200)) in lower(s.published::text))>0)
 order by s.published_at desc,s.id limit least(greatest(p_limit,1),30) offset least(greatest(p_offset,0),10000)
$$;
create or replace function app.sigma_public_story(p_owner text,p_slug text)
returns table(id uuid,slug text,owner text,owner_name text,published_at timestamptz,document jsonb)
language sql stable security definer set search_path=app,pg_catalog as $$
 select s.id,p.slug,profile.handle::text,profile.display_name,s.published_at,s.published
 from app.sigma_stories s join app.posts p on p.id=s.id and p.is_public join app.profiles profile on profile.id=p.author_profile_id and profile.is_public
 where s.published is not null and lower(profile.handle)=lower(p_owner) and p.slug=p_slug
$$;
create or replace function app.sigma_media_access(p_id uuid,p_url text,p_write boolean default false)
returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select exists(select 1 from app.sigma_stories s join app.posts p on p.id=s.id join app.profiles profile on profile.id=p.author_profile_id
 where s.id=p_id and (
  (app.current_actor_kind()='clerk' and (p.author_profile_id=app.current_profile_id() or app.sigma_is_editor()))
  or (not p_write and p.is_public and profile.is_public and exists(select 1 from jsonb_array_elements(s.published->'images') image where image->>'url'=p_url))
 ))
$$;

create or replace function app.sigma_request_subscription(p_email text,p_locale text)
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare s app.sigma_subscribers;
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then raise exception 'sigma_web_required'; end if;
 if p_locale not in ('en','ru','zh-CN') or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'sigma_invalid_subscription'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(p_email),46));
 select * into s from app.sigma_subscribers where email=lower(p_email) for update;
 if found and (s.status='active' or s.requested_at>now()-interval '10 minutes') then return null; end if;
 insert into app.sigma_subscribers(email,locale) values(lower(p_email),p_locale)
 on conflict(email) do update set locale=excluded.locale,status='pending',confirmation_nonce=gen_random_uuid(),requested_at=now()
 returning * into s;
 return jsonb_build_object('id',s.id,'nonce',s.confirmation_nonce,'locale',s.locale);
end $$;
create or replace function app.sigma_subscription_state(p_id uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object('id',id,'nonce',confirmation_nonce,'version',token_version,'locale',locale,'status',status,'requested_at',requested_at)
 from app.sigma_subscribers where id=p_id and app.context_is_verified() and app.current_context_service()='web'
$$;
create or replace function app.sigma_subscription_action(p_id uuid,p_nonce uuid,p_action text,p_locale text default null)
returns boolean language plpgsql security definer set search_path=app,pg_catalog as $$
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then raise exception 'sigma_web_required'; end if;
 if p_action='confirm' then
  update app.sigma_subscribers set status='active',confirmed_at=now(),unsubscribed_at=null,token_version=gen_random_uuid()
   where id=p_id and confirmation_nonce=p_nonce and status='pending' and requested_at>now()-interval '24 hours';
 elsif p_action='unsubscribe' then
  update app.sigma_subscribers set status='unsubscribed',unsubscribed_at=coalesce(unsubscribed_at,now()) where id=p_id and token_version=p_nonce;
 elsif p_action='language' and p_locale in ('en','ru','zh-CN') then
  update app.sigma_subscribers set locale=p_locale where id=p_id and token_version=p_nonce and status='active';
 else raise exception 'sigma_invalid_action'; end if;
 return found;
end $$;

create or replace function app.sigma_prepare_edition(p_id uuid,p_stories uuid[])
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare snapshot jsonb; result jsonb;
begin
 if not app.sigma_is_editor() then raise exception 'sigma_editor_required'; end if;
 if cardinality(p_stories) not between 1 and 15 then raise exception 'sigma_choose_stories'; end if;
 select jsonb_agg(jsonb_build_object('id',s.id,'slug',p.slug,'owner',profile.handle,'document',s.published) order by chosen.position) into snapshot
 from unnest(p_stories) with ordinality chosen(id,position) join app.sigma_stories s on s.id=chosen.id and s.published is not null
 join app.posts p on p.id=s.id and p.is_public join app.profiles profile on profile.id=p.author_profile_id and profile.is_public;
 if coalesce(jsonb_array_length(snapshot),0)<>cardinality(p_stories) or (select count(distinct x) from unnest(p_stories) x)<>cardinality(p_stories) then raise exception 'sigma_choose_published_stories'; end if;
 insert into app.sigma_editions(id,created_by,stories) values(p_id,app.current_profile_id(),snapshot) on conflict(id) do nothing;
 select jsonb_build_object('id',e.id,'stories',e.stories,'created_at',e.created_at,'started_at',e.started_at,'subscribers',(select count(*) from app.sigma_subscribers where status='active')) into result from app.sigma_editions e where e.id=p_id;
 return result;
end $$;
create or replace function app.sigma_editions_list()
returns setof jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select jsonb_build_object('id',e.id,'stories',e.stories,'created_at',e.created_at,'started_at',e.started_at,
  'subscribers',(select count(*) from app.sigma_subscribers where status='active'),
  'sent',(select count(*) from app.sigma_deliveries where edition_id=e.id and status='sent'),
  'remaining',(select count(*) from app.sigma_deliveries where edition_id=e.id and status in ('queued','sending')),
  'failed',(select count(*) from app.sigma_deliveries where edition_id=e.id and status='failed'))
 from app.sigma_editions e where app.sigma_is_editor() order by e.created_at desc limit 20
$$;
create or replace function app.sigma_claim_deliveries(p_id uuid)
returns table(id uuid,email text,locale text,subscriber_id uuid,token_version uuid,stories jsonb,created_at timestamptz)
language plpgsql security definer set search_path=app,pg_catalog as $$
declare e app.sigma_editions;
begin
 if not app.sigma_is_editor() or not app.context_is_admin() then raise exception 'sigma_admin_required'; end if;
 select * into e from app.sigma_editions where app.sigma_editions.id=p_id for update;
 if not found then raise exception 'sigma_edition_not_found'; end if;
 if e.started_at is null then
  insert into app.sigma_deliveries(edition_id,subscriber_id,locale,token_version)
   select p_id,s.id,s.locale,s.token_version from app.sigma_subscribers s where s.status='active' on conflict do nothing;
  update app.sigma_editions set started_at=now() where app.sigma_editions.id=p_id;
 end if;
 -- Ambiguous sends are never retried after the provider's 24-hour deduplication window.
 update app.sigma_deliveries d set status='failed' where d.edition_id=p_id and d.status='sending' and d.first_attempt_at<now()-interval '23 hours';
 update app.sigma_deliveries d set status='skipped' where d.edition_id=p_id and d.status in ('queued','sending')
  and not exists(select 1 from app.sigma_subscribers s where s.id=d.subscriber_id and s.status='active' and s.token_version=d.token_version);
 return query with claim as (
  select d.id from app.sigma_deliveries d where d.edition_id=p_id and (d.status='queued' or (d.status='sending' and d.claimed_at<now()-interval '2 minutes'))
  order by d.id limit 3 for update skip locked
 ), updated as (
  update app.sigma_deliveries d set status='sending',claimed_at=now(),first_attempt_at=coalesce(d.first_attempt_at,now()) from claim where d.id=claim.id returning d.*
 ) select u.id,s.email,u.locale,u.subscriber_id,u.token_version,e.stories,e.created_at from updated u join app.sigma_subscribers s on s.id=u.subscriber_id;
end $$;
create or replace function app.sigma_finish_delivery(p_id uuid,p_provider text,p_failed boolean default false)
returns void language plpgsql security definer set search_path=app,pg_catalog as $$
begin
 if not app.sigma_is_editor() or not app.context_is_admin() then raise exception 'sigma_admin_required'; end if;
 update app.sigma_deliveries set status=case when p_failed then 'failed' else 'sent' end,provider_id=left(p_provider,200) where id=p_id and status='sending';
end $$;

do $grants$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname like 'sigma_%' loop
  execute format('revoke all on function %s from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend',f.signature);
  execute format('grant execute on function %s to superii_web_backend',f.signature);
 end loop;
end $grants$;
commit;
