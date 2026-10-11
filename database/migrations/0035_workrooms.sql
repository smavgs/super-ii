-- Private, persistent working context. Reported results are not verification.
begin;
create table if not exists app.workrooms (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  organization_id uuid references app.organizations(id) on delete cascade,
  repository_id uuid references app.repositories(id) on delete set null,
  revision_id uuid references app.repository_revisions(id) on delete set null,
  source_commit text,
  creation_key uuid not null, creation_document jsonb not null,
  document jsonb not null, version integer not null default 1,
  status text not null default 'active' check (status in ('active','blocked','review','complete','archived')),
  reviewed_entry_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_profile_id,creation_key)
);
create table if not exists app.workroom_entries (
  id uuid primary key default gen_random_uuid(),
  workroom_id uuid not null references app.workrooms(id) on delete cascade,
  profile_id uuid not null references app.profiles(id),
  agent_id uuid references app.agent_identities(id),
  creation_key uuid not null, document jsonb not null,
  created_at timestamptz not null default now(),
  unique(workroom_id,profile_id,creation_key)
);
create table if not exists app.workroom_collaborators (
  workroom_id uuid not null references app.workrooms(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  primary key(workroom_id,profile_id)
);
create index if not exists workroom_owner_updated on app.workrooms(owner_profile_id,updated_at desc);
create index if not exists workroom_repository on app.workrooms(repository_id,organization_id);
create index if not exists workroom_entries_room on app.workroom_entries(workroom_id,created_at desc,id);
alter table app.workrooms enable row level security;
alter table app.workroom_entries enable row level security;
alter table app.workroom_collaborators enable row level security;
revoke all on app.workrooms,app.workroom_entries,app.workroom_collaborators
  from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;

create or replace function app.workroom_url_valid(p_url text)
returns boolean language sql immutable set search_path = app,pg_catalog as $$
 select p_url is not null and app.company_product_url(p_url)
   and p_url !~ '[[:space:]]' and p_url !~* '[?&][^=&#]*(token|secret|password|credential|signature|api.?key)[^=&#]*='
$$;
create or replace function app.workroom_document_valid(p_doc jsonb,p_entry boolean default false)
returns boolean language plpgsql immutable set search_path = app,pg_catalog as $$
declare k text;
begin
 if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text)>40000 then return false; end if;
 if p_entry then
   if p_doc-array['kind','body','url','sha256']<>'{}'::jsonb then return false; end if;
   foreach k in array array['kind','body','url','sha256'] loop
     if not coalesce(app.company_product_text(p_doc,k,case when k='body' then 8000 when k='url' then 2048 else 64 end),false) then return false; end if;
   end loop;
   return p_doc->>'kind' in ('note','result','blocker') and length(btrim(p_doc->>'body'))>0
     and app.workroom_url_valid(p_doc->>'url') and p_doc->>'sha256' ~ '^([a-f0-9]{64})?$';
 end if;
 if p_doc-array['title','kind','goal','acceptance','next_action','source_url','source_revision']<>'{}'::jsonb then return false; end if;
 foreach k in array array['title','kind','goal','acceptance','next_action','source_url','source_revision'] loop
   if not coalesce(app.company_product_text(p_doc,k,case when k='title' then 160 when k='kind' then 20
     when k='next_action' then 1000 when k='source_url' then 2048 when k='source_revision' then 200 else 2000 end),false) then return false; end if;
 end loop;
 return p_doc->>'kind' in ('model','dataset','app','notebook','research','robot','component','hardware')
   and length(btrim(p_doc->>'title'))>=2 and length(btrim(p_doc->>'goal'))>=3 and app.workroom_url_valid(p_doc->>'source_url');
end $$;

create or replace function app.can_access_workroom(p_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path = app,pg_catalog as $$
 select coalesce(app.context_is_verified() and app.current_actor_kind()='clerk' and exists (
   select 1 from app.workrooms w where w.id=p_id and (
     (w.organization_id is null and w.owner_profile_id=app.current_profile_id())
     or exists(select 1 from app.organization_members m where m.organization_id=w.organization_id
       and m.profile_id=app.current_profile_id() and (not p_write or m.role in ('owner','admin','maintainer')))
     or (w.organization_id is null and exists(select 1 from app.workroom_collaborators c where c.workroom_id=w.id
       and c.profile_id=app.current_profile_id() and (not p_write or c.role='editor')))
   )),false)
$$;
-- Internal representation has no public grant. Gateways check access before using it.
create or replace function app.workroom_snapshot(p_id uuid)
returns jsonb language sql stable security definer set search_path = app,pg_catalog as $$
 select to_jsonb(w)-'creation_key'-'creation_document' || jsonb_build_object(
   'can_edit',app.can_access_workroom(w.id,true),
   'can_share',app.current_actor_kind()='clerk' and w.organization_id is null and w.owner_profile_id=app.current_profile_id(),
   'repository',(select jsonb_build_object('kind',r.kind,'owner',r.owner_handle,'slug',r.slug,'status',r.status,
      'commit_sha',w.source_commit,'revision_status',(select status from app.repository_revisions v where v.id=w.revision_id)) from app.repositories r where r.id=w.repository_id),
   'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'document',e.document,'agent',e.agent_id is not null,
      'actor',coalesce(a.display_name,p.display_name),'evidence','reported','created_at',e.created_at) order by e.created_at,e.id)
      from app.workroom_entries e join app.profiles p on p.id=e.profile_id left join app.agent_identities a on a.id=e.agent_id where e.workroom_id=w.id),'[]'::jsonb),
   'collaborators',coalesce((select jsonb_agg(jsonb_build_object('handle',p.handle,'role',c.role) order by p.handle)
      from app.workroom_collaborators c join app.profiles p on p.id=c.profile_id where c.workroom_id=w.id),'[]'::jsonb)
 ) from app.workrooms w where w.id=p_id
$$;
create or replace function app.read_workroom(p_id uuid)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 select app.workroom_snapshot(p_id) where app.can_access_workroom(p_id)
$$;
create or replace function app.workroom_workspace()
returns jsonb language plpgsql stable security definer set search_path=app,pg_catalog as $$
begin
 if not app.context_is_verified() or app.current_actor_kind() is distinct from 'clerk' then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 return jsonb_build_object(
   'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'status',w.status,'document',jsonb_build_object('title',w.document->>'title','kind',w.document->>'kind','goal',left(w.document->>'goal',240),'next_action',left(w.document->>'next_action',240))) order by updated_at desc,id)
      from app.workrooms w where app.can_access_workroom(w.id)),'[]'::jsonb),
   'organizations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name)
      from app.organizations o join app.organization_members m on m.organization_id=o.id
      where m.profile_id=app.current_profile_id() and m.role in ('owner','admin','maintainer')),'[]'::jsonb),
   'repositories',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'owner',r.owner_handle,'slug',r.slug,'organization_id',r.owner_organization_id) order by r.updated_at desc)
      from (select r.* from app.repositories r where r.owner_profile_id=app.current_profile_id()
        or exists(select 1 from app.organization_members m where m.organization_id=r.owner_organization_id
          and m.profile_id=app.current_profile_id() and m.role in ('owner','admin','maintainer')) order by r.updated_at desc limit 100) r),'[]'::jsonb)
 );
end $$;
create or replace function app.create_workroom(p_key uuid,p_org uuid,p_repo uuid,p_doc jsonb)
returns uuid language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.current_profile_id(); existing app.workrooms; result uuid; rev uuid; commit text;
begin
 if not app.context_is_verified() or app.current_actor_kind() is distinct from 'clerk' or actor is null then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 if p_key is null or not app.workroom_document_valid(p_doc) then raise exception 'workroom_invalid' using errcode='22023'; end if;
 if p_org is not null and not exists(select 1 from app.organization_members where organization_id=p_org and profile_id=actor and role in ('owner','admin','maintainer')) then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workroom:'||actor::text,0));
 select * into existing from app.workrooms where owner_profile_id=actor and creation_key=p_key;
 if existing.id is not null then
   if not app.can_access_workroom(existing.id,true) then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
   if existing.creation_document<>p_doc or existing.organization_id is distinct from p_org or existing.repository_id is distinct from p_repo then raise exception 'workroom_retry_conflict' using errcode='40001'; end if;
   return existing.id;
 end if;
 if (select count(*) from app.workrooms where owner_profile_id=actor)>=200 then raise exception 'workroom_limit_reached'; end if;
 if p_repo is not null then
   if not exists(select 1 from app.repositories r where r.id=p_repo and app.can_access_repository(r.id,true)
      and (p_org is null or r.owner_organization_id=p_org)) then raise exception 'workroom_reference_denied' using errcode='42501'; end if;
   select v.id,v.commit_sha into rev,commit from app.repositories r
     left join app.repository_branches b on b.repository_id=r.id and b.is_default
     left join app.repository_revisions v on v.id=coalesce(b.head_revision_id,r.latest_revision_id) where r.id=p_repo;
 end if;
 insert into app.workrooms(owner_profile_id,organization_id,repository_id,revision_id,source_commit,creation_key,creation_document,document)
 values(actor,p_org,p_repo,rev,commit,p_key,p_doc,p_doc) returning id into result;
 return result;
end $$;
create or replace function app.save_workroom(p_id uuid,p_version integer,p_doc jsonb,p_status text,p_reviewed uuid)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare w app.workrooms;
begin
 select * into w from app.workrooms where id=p_id for update;
 if not app.can_access_workroom(p_id,true) then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 if p_version is distinct from w.version then raise exception 'workroom_version_conflict' using errcode='40001'; end if;
 if not app.workroom_document_valid(p_doc) or p_status is null or p_status not in ('active','blocked','review','complete','archived') then raise exception 'workroom_invalid' using errcode='22023'; end if;
 if p_status='complete' and (p_reviewed is null or not exists(select 1 from app.workroom_entries where id=p_reviewed and workroom_id=p_id and document->>'kind'='result')) then raise exception 'workroom_review_required' using errcode='22023'; end if;
 update app.workrooms set document=p_doc,status=p_status,reviewed_entry_id=case when p_status='complete' then p_reviewed else null end,
   version=version+1,updated_at=now() where id=p_id;
 return app.workroom_snapshot(p_id);
end $$;
create or replace function app.add_workroom_entry(p_id uuid,p_key uuid,p_doc jsonb)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare w app.workrooms; existing app.workroom_entries;
begin
 select * into w from app.workrooms where id=p_id for update;
 if not app.can_access_workroom(p_id,true) then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 if p_key is null or not app.workroom_document_valid(p_doc,true) then raise exception 'workroom_invalid' using errcode='22023'; end if;
 select * into existing from app.workroom_entries where workroom_id=p_id and profile_id=app.current_profile_id() and creation_key=p_key;
 if existing.id is not null then
   if existing.document<>p_doc or existing.agent_id is not null then raise exception 'workroom_retry_conflict' using errcode='40001'; end if;
   return app.workroom_snapshot(p_id);
 end if;
 if w.status='archived' or (select count(*) from app.workroom_entries where workroom_id=p_id)>=300 then raise exception 'workroom_entry_limit_or_archived'; end if;
 insert into app.workroom_entries(workroom_id,profile_id,creation_key,document) values(p_id,app.current_profile_id(),p_key,p_doc);
 update app.workrooms set version=version+1,updated_at=now(),
   status=case when p_doc->>'kind'='result' then 'review' when p_doc->>'kind'='blocker' then 'blocked' else status end,
   reviewed_entry_id=case when p_doc->>'kind' in ('result','blocker') then null else reviewed_entry_id end where id=p_id;
 return app.workroom_snapshot(p_id);
end $$;
create or replace function app.share_workroom(p_id uuid,p_handle text,p_role text)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare w app.workrooms; member uuid;
begin
 select * into w from app.workrooms where id=p_id for update;
 if not app.can_access_workroom(p_id,true) or w.organization_id is not null or w.owner_profile_id<>app.current_profile_id() then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 if p_role is null or p_role not in ('viewer','editor','remove') then raise exception 'workroom_invalid'; end if;
 select p.id into member from app.profiles p where lower(p.handle)=lower(p_handle) and (p.is_public
   or exists(select 1 from app.workroom_collaborators c where c.workroom_id=p_id and c.profile_id=p.id));
 if member is null or member=w.owner_profile_id then raise exception 'workroom_member_unavailable'; end if;
 if p_role='remove' then delete from app.workroom_collaborators where workroom_id=p_id and profile_id=member;
 else
   if (select count(*) from app.workroom_collaborators where workroom_id=p_id)>=20 and not exists(select 1 from app.workroom_collaborators where workroom_id=p_id and profile_id=member) then raise exception 'workroom_limit_reached'; end if;
   insert into app.workroom_collaborators(workroom_id,profile_id,role) values(p_id,member,p_role)
   on conflict(workroom_id,profile_id) do update set role=excluded.role;
 end if;
 return app.workroom_snapshot(p_id);
end $$;

-- Machine access is added below with explicit new scopes. Existing grants do not expand.
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_action_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_action_check check (action in (
 'repository.create','revision.create','transfer.create','revision.commit','revision.submit','job.claim','job.submit',
 'robot.create','robot.version.create','transparency.watch','workroom.report'
));
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_target_type_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_target_type_check check (
 target_type in ('repository','revision','transfer','job','submission','robot','robot_version','transparency_report','workroom')
);

alter table app.agent_access_tokens drop constraint if exists agent_access_tokens_scopes_check;
alter table app.agent_access_tokens add constraint agent_access_tokens_scopes_check check (cardinality(scopes) between 1 and 16 and scopes <@ array['repository:read','repository:create','repository:upload','repository:commit','repository:submit','robot:read','robot:create','robot:update','transparent:read','transparent:watch','events:read','receipts:read','jobs:claim','jobs:submit','workroom:read','workroom:report']::text[]);
create or replace function app.start_agent_connection(
  p_client uuid, p_grant text, p_resource text, p_scopes text[], p_redirect text,
  p_state text, p_challenge text, p_device_hash text, p_user_hash text
)
returns uuid language plpgsql security definer set search_path = app, pg_catalog as $$
declare client app_private.agent_oauth_clients; result uuid;
begin
  select * into client from app_private.agent_oauth_clients where id = p_client;
  if client.id is null then raise exception 'invalid_client'; end if;
  if p_scopes is null or p_resource is null or cardinality(p_scopes) not between 1 and 16 or not (
    (p_resource = 'work' and p_scopes <@ array['repository:read','repository:create','repository:upload','repository:commit','repository:submit','robot:read','robot:create','robot:update','transparent:read','transparent:watch','events:read','receipts:read','jobs:claim','jobs:submit','workroom:read','workroom:report']::text[])
    or (p_resource = 'social' and p_scopes <@ array['social.read','social.post','social.reply','social.vote','social.follow','social.profile.read','social.profile.write','social.notifications.read']::text[] and 'social.read' = any(p_scopes))
  ) then raise exception 'invalid_scope'; end if;
  if p_grant = 'authorization_code' then
    if p_redirect is null or not (client.redirect_uris ? p_redirect)
      or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
      or p_device_hash is not null or p_user_hash is not null then raise exception 'invalid_request'; end if;
  elsif p_grant = 'device_code' then
    if p_device_hash is null or p_user_hash is null or p_redirect is not null then raise exception 'invalid_request'; end if;
  else raise exception 'unsupported_grant_type'; end if;
  delete from app_private.agent_connection_requests where status = 'pending' and expires_at < now() - interval '1 day';
  insert into app_private.agent_connection_requests(client_id,grant_type,resource,requested_scopes,redirect_uri,state,code_challenge,exchange_hash,user_code_hash)
    values (p_client,p_grant,p_resource,p_scopes,p_redirect,p_state,p_challenge,p_device_hash,p_user_hash) returning id into result;
  return result;
end $$;

create or replace function app.consume_agent_access_token(p_token_hash text, p_scope text, p_repository_id uuid default null)
returns table(token_id uuid, agent_identity_id uuid, operator_profile_id uuid, operator_organization_id uuid, granted_scopes text[], bound_repository_id uuid)
language plpgsql security definer set search_path = app, pg_catalog as $$
declare is_read boolean := p_scope in ('repository:read','robot:read','transparent:read','events:read','receipts:read','workroom:read');
begin
  if p_token_hash is null or p_scope is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_scope not in (
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','transparent:read','transparent:watch',
    'events:read','receipts:read','jobs:claim','jobs:submit','workroom:read','workroom:report'
  ) then return; end if;
  return query update app.agent_access_tokens token
  set actions_used = token.actions_used + case when is_read then 0 else 1 end, last_used_at = now()
  from app.agent_identities identity, app.service_accounts service_account, app.organization_members operator_member
  where token.token_hash = p_token_hash and identity.id = token.agent_identity_id
    and service_account.id = identity.service_account_id and operator_member.organization_id = identity.organization_id
    and operator_member.profile_id = token.created_by_profile_id and operator_member.role in ('owner','admin')
    and service_account.disabled_at is null and identity.status = 'active' and token.revoked_at is null
    and token.expires_at > now() and (is_read or token.actions_used < token.max_actions) and p_scope = any(token.scopes)
    and (token.repository_id is null or token.repository_id = p_repository_id)
    and (p_repository_id is null or exists (select 1 from app.repositories repository where repository.id = p_repository_id and repository.owner_organization_id = identity.organization_id))
  returning token.id, identity.id, token.created_by_profile_id, identity.organization_id, token.scopes, token.repository_id;
end $$;


create or replace function app.agent_read_workroom(p_hash text,p_repo uuid,p_id uuid,p_before uuid default null)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog as $$
declare actor record; cursor_time timestamptz; rooms jsonb; next_before uuid;
begin
 if p_repo is null then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 select * into actor from app.consume_agent_access_token(p_hash,'workroom:read',p_repo);
 if actor.token_id is null then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 if p_id is null then
   if p_before is not null then
     select updated_at into cursor_time from app.workrooms where id=p_before and repository_id=p_repo and organization_id=actor.operator_organization_id;
     if cursor_time is null then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'title',w.document->>'title','kind',w.document->>'kind','goal',left(w.document->>'goal',240),'version',w.version,'status',w.status) order by w.updated_at desc,w.id desc),'[]'::jsonb) into rooms
     from (select * from app.workrooms where repository_id=p_repo and organization_id=actor.operator_organization_id
       and (p_before is null or (updated_at,id)<(cursor_time,p_before)) order by updated_at desc,id desc limit 50) w;
   if jsonb_array_length(rooms)=50 then next_before:=(rooms->49->>'id')::uuid; end if;
   return jsonb_build_object('rooms',rooms,'next_before',next_before);
 end if;
 if not exists(select 1 from app.workrooms where id=p_id and repository_id=p_repo and organization_id=actor.operator_organization_id) then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 return app.workroom_snapshot(p_id)-'collaborators'-'owner_profile_id';
end $$;

create or replace function app.agent_report_workroom(p_hash text,p_repo uuid,p_id uuid,p_key uuid,p_doc jsonb)
returns jsonb language plpgsql volatile security definer set search_path=app,pg_catalog,public as $$
declare actor record; token app.agent_access_tokens; identity app.agent_identities; w app.workrooms;
 existing app.workroom_entries; entry_id uuid; receipt app.agent_action_receipts; result jsonb; request_hash text;
begin
 if p_repo is null or p_key is null or not app.workroom_document_valid(p_doc,true) then raise exception 'workroom_invalid'; end if;
 -- Lock the credential so an exact retry can succeed without another budget debit.
 select * into token from app.agent_access_tokens where token_hash=p_hash for update;
 select * into identity from app.agent_identities where id=token.agent_identity_id;
 if token.id is null or token.revoked_at is not null or token.expires_at<=now() or identity.status<>'active'
   or not ('workroom:report'=any(token.scopes)) or (token.repository_id is not null and token.repository_id<>p_repo)
   or not exists(select 1 from app.service_accounts where id=identity.service_account_id and disabled_at is null)
   or not exists(select 1 from app.organization_members where organization_id=identity.organization_id and profile_id=token.created_by_profile_id and role in ('owner','admin'))
   or not exists(select 1 from app.repositories where id=p_repo and owner_organization_id=identity.organization_id)
 then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 select * into w from app.workrooms where id=p_id for update;
 if w.id is null or w.repository_id is distinct from p_repo or w.organization_id is distinct from identity.organization_id then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 request_hash:=encode(public.digest(jsonb_build_object('room',p_id,'repository',p_repo,'document',p_doc)::text,'sha256'),'hex');
 select * into existing from app.workroom_entries where workroom_id=p_id and profile_id=token.created_by_profile_id and creation_key=p_key;
 if existing.id is not null then
   if existing.agent_id is distinct from identity.id or existing.document<>p_doc then raise exception 'workroom_retry_conflict' using errcode='40001'; end if;
   select * into receipt from app.agent_action_receipts where agent_identity_id=identity.id and idempotency_key='workroom:'||p_key::text;
   return jsonb_build_object('entry_id',existing.id,'evidence','reported','receipt',to_jsonb(receipt),'replayed',true,'workroom_status',w.status);
 end if;
 if w.status='archived' or (select count(*) from app.workroom_entries where workroom_id=p_id)>=300 then raise exception 'workroom_entry_limit_or_archived'; end if;
 select * into actor from app.consume_agent_access_token(p_hash,'workroom:report',p_repo);
 if actor.token_id is null then raise exception 'workroom_permission_denied' using errcode='42501'; end if;
 insert into app.workroom_entries(workroom_id,profile_id,agent_id,creation_key,document)
 values(p_id,token.created_by_profile_id,identity.id,p_key,p_doc) returning id into entry_id;
 update app.workrooms set version=version+1,updated_at=now(),
   status=case when p_doc->>'kind'='result' then 'review' when p_doc->>'kind'='blocker' then 'blocked' else status end,
   reviewed_entry_id=case when p_doc->>'kind' in ('result','blocker') then null else reviewed_entry_id end where id=p_id returning status into w.status;
 result:=jsonb_build_object('entry_id',entry_id,'evidence','reported','workroom_status',w.status);
 receipt:=app.record_agent_action_receipt(identity.id,token.id,token.created_by_profile_id,identity.organization_id,
   'workroom:'||p_key::text,'workroom.report','workroom',p_id,null,array['workroom:report']::text[],request_hash,
   encode(public.digest(result::text,'sha256'),'hex'),'succeeded','human-review-required',jsonb_build_object('result',result));
 return result||jsonb_build_object('receipt',to_jsonb(receipt),'replayed',false);
end $$;

do $$ declare signature text; begin
 foreach signature in array array[
  'app.workroom_url_valid(text)','app.workroom_document_valid(jsonb,boolean)',
  'app.can_access_workroom(uuid,boolean)','app.workroom_snapshot(uuid)',
  'app.read_workroom(uuid)','app.workroom_workspace()','app.create_workroom(uuid,uuid,uuid,jsonb)',
  'app.save_workroom(uuid,integer,jsonb,text,uuid)','app.add_workroom_entry(uuid,uuid,jsonb)',
  'app.share_workroom(uuid,text,text)','app.agent_read_workroom(text,uuid,uuid,uuid)',
  'app.agent_report_workroom(text,uuid,uuid,uuid,jsonb)'
 ] loop execute 'revoke all on function '||signature||' from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend'; end loop;
 foreach signature in array array[
  'app.read_workroom(uuid)','app.workroom_workspace()','app.create_workroom(uuid,uuid,uuid,jsonb)',
  'app.save_workroom(uuid,integer,jsonb,text,uuid)','app.add_workroom_entry(uuid,uuid,jsonb)',
  'app.share_workroom(uuid,text,text)','app.agent_read_workroom(text,uuid,uuid,uuid)',
  'app.agent_report_workroom(text,uuid,uuid,uuid,jsonb)'
 ] loop execute 'grant execute on function '||signature||' to superii_web_backend'; end loop;
end $$;
comment on table app.workrooms is 'Private work context. Completion is member-reviewed reported evidence, not independent verification.';
commit;
