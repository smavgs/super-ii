begin;

-- Protocol secrets stay outside the application tables and their tenant APIs.
create table if not exists app_private.agent_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array' and jsonb_array_length(redirect_uris) <= 8),
  created_at timestamptz not null default now()
);
create table if not exists app_private.agent_connection_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app_private.agent_oauth_clients(id),
  grant_type text not null check (grant_type in ('authorization_code','device_code')),
  resource text not null check (resource in ('work','social')),
  requested_scopes text[] not null,
  redirect_uri text,
  state text check (char_length(state) <= 2048),
  code_challenge text check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  exchange_hash text unique check (exchange_hash ~ '^[a-f0-9]{64}$'),
  user_code_hash text unique check (user_code_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','approved','denied','consumed','revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  last_polled_at timestamptz,
  poll_interval integer not null default 5 check (poll_interval between 5 and 60),
  approved_by uuid references app.profiles(id),
  approved_scopes text[],
  work_agent_id uuid references app.agent_identities(id),
  social_agent_id uuid references app.social_agents(id),
  repository_id uuid references app.repositories(id),
  max_actions integer check (max_actions between 1 and 10000),
  credential_expires_at timestamptz,
  work_token_id uuid references app.agent_access_tokens(id),
  social_token_id uuid references app.social_credentials(id),
  approved_at timestamptz,
  consumed_at timestamptz
);
create index if not exists agent_connection_owner_idx on app_private.agent_connection_requests(approved_by, created_at desc);
alter table app_private.agent_oauth_clients enable row level security;
alter table app_private.agent_connection_requests enable row level security;
revoke all on app_private.agent_oauth_clients, app_private.agent_connection_requests from public;

create or replace function app.register_agent_oauth_client(p_name text, p_redirects jsonb)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare result app_private.agent_oauth_clients; uri text;
begin
  if p_name is null or p_redirects is null or char_length(p_name) not between 1 and 120 or jsonb_typeof(p_redirects) <> 'array'
    or jsonb_array_length(p_redirects) > 8 then raise exception 'invalid_client_metadata'; end if;
  for uri in select jsonb_array_elements_text(p_redirects) loop
    if char_length(uri) > 2048 or uri !~ '^(https://[^/#@]+|http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?)/'
      or uri ~ '[#\s]' then raise exception 'invalid_redirect_uri'; end if;
  end loop;
  insert into app_private.agent_oauth_clients(name, redirect_uris) values (p_name, p_redirects) returning * into result;
  return jsonb_build_object('client_id',result.id,'client_name',result.name,'redirect_uris',result.redirect_uris,
    'client_id_issued_at',extract(epoch from result.created_at)::bigint,'token_endpoint_auth_method','none',
    'grant_types',jsonb_build_array('authorization_code','urn:ietf:params:oauth:grant-type:device_code'),
    'response_types',jsonb_build_array('code'));
end $$;

create or replace function app.start_agent_connection(
  p_client uuid, p_grant text, p_resource text, p_scopes text[], p_redirect text,
  p_state text, p_challenge text, p_device_hash text, p_user_hash text
)
returns uuid language plpgsql security definer set search_path = app, pg_catalog as $$
declare client app_private.agent_oauth_clients; result uuid;
begin
  select * into client from app_private.agent_oauth_clients where id = p_client;
  if client.id is null then raise exception 'invalid_client'; end if;
  if p_scopes is null or p_resource is null or cardinality(p_scopes) not between 1 and 14 or not (
    (p_resource = 'work' and p_scopes <@ array['repository:read','repository:create','repository:upload','repository:commit','repository:submit','robot:read','robot:create','robot:update','transparent:read','transparent:watch','events:read','receipts:read','jobs:claim','jobs:submit']::text[])
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

create or replace function app.read_agent_connection_request(p_id uuid, p_user_hash text)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare req app_private.agent_connection_requests; client app_private.agent_oauth_clients;
begin
  if app.current_actor_kind() is distinct from 'clerk' or app.current_profile_id() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into req from app_private.agent_connection_requests
    where (id = p_id and grant_type = 'authorization_code') or (user_code_hash = p_user_hash and grant_type = 'device_code');
  if req.id is null or req.expires_at <= now() or req.status <> 'pending' then return null; end if;
  select * into client from app_private.agent_oauth_clients where id = req.client_id;
  return jsonb_build_object('id',req.id,'client_name',client.name,'resource',req.resource,'scopes',req.requested_scopes,
    'redirect_uri',req.redirect_uri,'grant_type',req.grant_type,'expires_at',req.expires_at);
end $$;

create or replace function app.approve_agent_connection(p_id uuid, p_profile uuid, p_allow boolean, p_options jsonb, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare
  req app_private.agent_connection_requests; scopes text[]; organization uuid; identity uuid; social_id uuid;
  days integer; actions integer; repo uuid; client_name text; handle text; display_name text; created record;
begin
  if app.current_actor_kind() is distinct from 'clerk' or p_profile is null or app.current_profile_id() is distinct from p_profile then
    raise exception 'authentication_required' using errcode='42501'; end if;
  select * into req from app_private.agent_connection_requests where id=p_id for update;
  if req.id is null or req.status <> 'pending' or req.expires_at <= now() then raise exception 'request_expired_or_used'; end if;
  if p_allow is null or p_options is null or jsonb_typeof(p_options) <> 'object' then raise exception 'invalid_approval'; end if;
  if not p_allow then
    update app_private.agent_connection_requests set status='denied', approved_by=p_profile where id=req.id;
    return jsonb_build_object('redirect_uri',req.redirect_uri,'state',req.state,'denied',true);
  end if;
  select array_agg(value) into scopes from jsonb_array_elements_text(p_options->'scopes');
  days := coalesce((p_options->>'expires_in_days')::integer,7);
  actions := coalesce((p_options->>'max_actions')::integer,500);
  repo := nullif(p_options->>'repository_id','')::uuid;
  if cardinality(scopes) is null or cardinality(scopes) < 1 or not scopes <@ req.requested_scopes
    or days not between 1 and 30 or actions not between 1 and 10000
    or (repo is not null and exists(select 1 from unnest(scopes) s where s like 'robot:%'))
    or (req.grant_type='authorization_code' and (p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$')) then raise exception 'invalid_approval'; end if;
  select name into client_name from app_private.agent_oauth_clients where id=req.client_id;
  display_name := coalesce(nullif(p_options->>'display_name',''),client_name);
  handle := coalesce(nullif(p_options->>'handle',''),'agent-' || left(replace(req.id::text,'-',''),16));
  if req.resource='work' then
    identity := nullif(p_options->>'agent_id','')::uuid;
    if identity is not null then
      select a.organization_id into organization from app.agent_identities a
        join app.organization_members m on m.organization_id=a.organization_id
        join app.service_accounts sa on sa.id=a.service_account_id
        where a.id=identity and a.status='active' and sa.disabled_at is null
          and m.profile_id=p_profile and m.role in ('owner','admin');
      if organization is null then raise exception 'operator_access_required' using errcode='42501'; end if;
    else
      organization := nullif(p_options->>'organization_id','')::uuid;
      if organization is null then
        if p_options->>'create_organization' is distinct from 'true' then raise exception 'organization_required'; end if;
        organization := app.create_organization(p_profile,p_options->>'organization_handle','community',p_options->>'organization_name',null,null,null,null,null,'[]'::jsonb);
      end if;
      select * into created from app.create_agent_identity(p_profile,organization,handle,display_name,'Connected through human approval.','other',null,false);
      identity := created.agent_identity_id;
    end if;
    if repo is not null and not exists(select 1 from app.repositories where id=repo and owner_organization_id=organization) then raise exception 'repository_binding_mismatch'; end if;
  else
    if not 'social.read'=any(scopes) then raise exception 'social_read_required'; end if;
    social_id := nullif(p_options->>'agent_id','')::uuid;
    if social_id is null then
      organization := nullif(p_options->>'organization_id','')::uuid;
      select * into created from app.create_social_agent(p_profile,organization,handle,display_name,
        coalesce(p_options->>'bio',''),null,null,'other','{}'::text[],'{}'::text[],'{}'::text[],
        'manual',5,25,300);
      social_id := created.id;
    end if;
    if not exists(select 1 from app.social_agents a where a.id=social_id and a.owner_profile_id=p_profile and a.status in ('active','pairing')
      and app.social_agent_slot_limit(a.owner_profile_id,a.sponsor_organization_id)>0) then raise exception 'active_sponsored_agent_required' using errcode='42501'; end if;
  end if;
  update app_private.agent_connection_requests set status='approved',approved_by=p_profile,approved_at=now(),
    approved_scopes=scopes,work_agent_id=identity,social_agent_id=social_id,repository_id=repo,max_actions=actions,
    credential_expires_at=now()+make_interval(days=>days),
    exchange_hash=case when grant_type='authorization_code' then p_code_hash else exchange_hash end
    where id=req.id;
  return jsonb_build_object('redirect_uri',req.redirect_uri,'state',req.state,'denied',false);
end $$;

create or replace function app.exchange_agent_connection(p_client uuid,p_secret text,p_grant text,p_resource text,p_redirect text,p_verifier text,p_token_hash text,p_token_prefix text)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare req app_private.agent_connection_requests; token_id uuid; challenge text; actor app.agent_identities; social app.social_agents;
begin
  if p_secret is null or p_token_hash is null or p_token_prefix is null or char_length(p_secret) not between 40 and 128 or p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_grant'); end if;
  select * into req from app_private.agent_connection_requests
    where exchange_hash=encode(public.digest(p_secret,'sha256'),'hex') and client_id=p_client for update;
  if req.id is null or req.grant_type is distinct from p_grant or req.resource is distinct from p_resource then return jsonb_build_object('error','invalid_grant'); end if;
  if req.expires_at<=now() then return jsonb_build_object('error',case when p_grant='device_code' then 'expired_token' else 'invalid_grant' end); end if;
  if p_grant='authorization_code' then
    if p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' or p_redirect is distinct from req.redirect_uri then return jsonb_build_object('error','invalid_grant'); end if;
    challenge := rtrim(translate(encode(public.digest(p_verifier,'sha256'),'base64'),'+/','-_'),'=');
    if challenge is distinct from req.code_challenge then return jsonb_build_object('error','invalid_grant'); end if;
  else
    if req.last_polled_at is not null and req.last_polled_at>clock_timestamp()-make_interval(secs=>req.poll_interval) then
      update app_private.agent_connection_requests set poll_interval=least(60,poll_interval+5),last_polled_at=clock_timestamp() where id=req.id;
      return jsonb_build_object('error','slow_down');
    end if;
    update app_private.agent_connection_requests set last_polled_at=clock_timestamp() where id=req.id;
  end if;
  if req.status='pending' then return jsonb_build_object('error','authorization_pending'); end if;
  if req.status='denied' then return jsonb_build_object('error','access_denied'); end if;
  if req.status<>'approved' or req.credential_expires_at<=now() then return jsonb_build_object('error','invalid_grant'); end if;
  if req.resource='work' then
    select * into actor from app.agent_identities where id=req.work_agent_id;
    if actor.status<>'active' or not exists(select 1 from app.organization_members where organization_id=actor.organization_id
      and profile_id=req.approved_by and role in ('owner','admin')) or not exists(select 1 from app.service_accounts where id=actor.service_account_id and disabled_at is null)
      or (req.repository_id is not null and not exists(select 1 from app.repositories where id=req.repository_id and owner_organization_id=actor.organization_id))
      or p_token_prefix !~ '^sii_agent_[a-f0-9]{8}$' then return jsonb_build_object('error','access_denied'); end if;
    insert into app.agent_access_tokens(agent_identity_id,created_by_profile_id,token_prefix,token_hash,scopes,repository_id,max_actions,spend_limit_cents,expires_at)
      values(actor.id,req.approved_by,p_token_prefix,p_token_hash,req.approved_scopes,req.repository_id,req.max_actions,0,req.credential_expires_at) returning id into token_id;
    update app_private.agent_connection_requests set work_token_id=token_id where id=req.id;
  else
    select * into social from app.social_agents where id=req.social_agent_id;
    if social.id is null or social.status not in ('active','pairing') or social.owner_profile_id<>req.approved_by or app.social_agent_slot_limit(social.owner_profile_id,social.sponsor_organization_id)<1
      or p_token_prefix !~ '^sii_social_[a-f0-9]{8}$' then return jsonb_build_object('error','access_denied'); end if;
    insert into app.social_credentials(social_agent_id,owner_profile_id,token_prefix,token_hash,scopes,expires_at)
      values(social.id,req.approved_by,p_token_prefix,p_token_hash,req.approved_scopes,req.credential_expires_at) returning id into token_id;
    update app.social_agents set status='active',paired_at=now() where id=social.id;
    update app_private.agent_connection_requests set social_token_id=token_id where id=req.id;
  end if;
  update app_private.agent_connection_requests set status='consumed',consumed_at=now() where id=req.id;
  return jsonb_build_object('connection_id',req.id,'scope',array_to_string(req.approved_scopes,' '),'expires_in',greatest(0,extract(epoch from(req.credential_expires_at-now()))::integer));
end $$;

create or replace function app.inspect_agent_connection(p_hash text,p_resource text)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare token app.agent_access_tokens; actor app.agent_identities; credential app.social_credentials; social app.social_agents; reason text;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','invalid_token'); end if;
  if p_resource='work' then
    select * into token from app.agent_access_tokens where token_hash=p_hash;
    if token.id is null then return jsonb_build_object('status','invalid_token'); end if;
    select * into actor from app.agent_identities where id=token.agent_identity_id;
    reason := case when token.revoked_at is not null then 'revoked' when token.expires_at<=now() then 'expired'
      when actor.status<>'active' or not exists(select 1 from app.service_accounts where id=actor.service_account_id and disabled_at is null) then 'paused'
      when not exists(select 1 from app.organization_members where organization_id=actor.organization_id and profile_id=token.created_by_profile_id and role in ('owner','admin')) then 'operator_changed'
      when token.actions_used>=token.max_actions then 'action_limit_reached' else 'active' end;
    return jsonb_build_object('status',reason,'resource','work','agent_id',actor.id,'handle',actor.handle,'organization_id',actor.organization_id,
      'scopes',token.scopes,'repository_id',token.repository_id,'expires_at',token.expires_at,'actions_remaining',token.max_actions-token.actions_used,'spend_limit_cents',0);
  elsif p_resource='social' then
    select * into credential from app.social_credentials where token_hash=p_hash;
    if credential.id is null then return jsonb_build_object('status','invalid_token'); end if;
    select * into social from app.social_agents where id=credential.social_agent_id;
    reason := case when credential.revoked_at is not null or social.status='revoked' then 'revoked' when credential.expires_at<=now() then 'expired'
      when social.status='paused' then 'paused' when app.social_agent_slot_limit(social.owner_profile_id,social.sponsor_organization_id)<1 then 'sponsorship_required' else 'active' end;
    return jsonb_build_object('status',reason,'resource','social','agent_id',social.id,'handle',social.handle,'scopes',credential.scopes,
      'expires_at',credential.expires_at,'autonomy',social.autonomy_level,'topics',social.topics,'blocked_topics',social.blocked_topics,
      'max_posts_per_day',social.max_posts_per_day,'max_replies_per_day',social.max_replies_per_day,
      'poll_interval_seconds',social.poll_interval_seconds,'acknowledged_event_cursor',social.acknowledged_event_cursor);
  end if;
  return jsonb_build_object('status','invalid_token');
end $$;

create or replace function app.list_agent_connections()
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare profile uuid := app.current_profile_id(); result jsonb;
begin
  if app.current_actor_kind() is distinct from 'clerk' or profile is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(record order by record.created_at desc),'[]'::jsonb) into result from (
    select r.id,c.name as client_name,r.resource,r.status,r.created_at,r.credential_expires_at as expires_at,r.approved_scopes as scopes,
      coalesce(a.display_name,s.display_name) as agent_name,coalesce(a.handle,s.handle) as handle,
      coalesce(t.last_used_at,st.last_used_at) as last_used_at,
      case when r.status='revoked' or coalesce(t.revoked_at,st.revoked_at) is not null then 'revoked'
        when r.status='approved' and r.expires_at<=now() then 'approval_expired'
        when r.credential_expires_at<=now() then 'expired' when r.status='consumed' then
          app.inspect_agent_connection(coalesce(t.token_hash,st.token_hash),r.resource)->>'status'
        else r.status end as connection_status,
      t.max_actions-t.actions_used as actions_remaining
    from app_private.agent_connection_requests r join app_private.agent_oauth_clients c on c.id=r.client_id
    left join app.agent_identities a on a.id=r.work_agent_id left join app.social_agents s on s.id=r.social_agent_id
    left join app.agent_access_tokens t on t.id=r.work_token_id left join app.social_credentials st on st.id=r.social_token_id
    where r.approved_by=profile and r.status in ('approved','consumed','revoked') order by r.created_at desc limit 100
  ) record;
  return result;
end $$;

create or replace function app.revoke_agent_connection(p_id uuid)
returns boolean language plpgsql security definer set search_path = app, pg_catalog as $$
declare req app_private.agent_connection_requests;
begin
  if app.current_actor_kind() is distinct from 'clerk' or app.current_profile_id() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into req from app_private.agent_connection_requests where id=p_id and approved_by=app.current_profile_id() for update;
  if req.id is null then return false; end if;
  update app.agent_access_tokens set revoked_at=coalesce(revoked_at,now()) where id=req.work_token_id;
  update app.social_credentials set revoked_at=coalesce(revoked_at,now()) where id=req.social_token_id;
  update app_private.agent_connection_requests set status='revoked' where id=req.id;
  return true;
end $$;

-- Verification reads remain available after the approved mutation budget is exhausted.
create or replace function app.consume_agent_access_token(p_token_hash text, p_scope text, p_repository_id uuid default null)
returns table(token_id uuid, agent_identity_id uuid, operator_profile_id uuid, operator_organization_id uuid, granted_scopes text[], bound_repository_id uuid)
language plpgsql security definer set search_path = app, pg_catalog as $$
declare is_read boolean := p_scope in ('repository:read','robot:read','transparent:read','events:read','receipts:read');
begin
  if p_token_hash is null or p_scope is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_scope not in (
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'robot:read','robot:create','robot:update','transparent:read','transparent:watch',
    'events:read','receipts:read','jobs:claim','jobs:submit'
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

do $grants$
declare signature text;
begin
  foreach signature in array array[
    'app.consume_agent_access_token(text,text,uuid)',
    'app.register_agent_oauth_client(text,jsonb)',
    'app.start_agent_connection(uuid,text,text,text[],text,text,text,text,text)',
    'app.read_agent_connection_request(uuid,text)',
    'app.approve_agent_connection(uuid,uuid,boolean,jsonb,text)',
    'app.exchange_agent_connection(uuid,text,text,text,text,text,text,text)',
    'app.inspect_agent_connection(text,text)',
    'app.list_agent_connections()',
    'app.revoke_agent_connection(uuid)'
  ] loop
    execute 'revoke all on function '||signature||' from public';
    execute 'grant execute on function '||signature||' to superii_web_backend';
  end loop;
end $grants$;
commit;
