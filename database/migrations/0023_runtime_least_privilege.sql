-- Activates independent least-privilege database identities for the website,
-- payment boundary, trusted-publishing exchange, and local runtime. Runtime
-- requests carry a short-lived HMAC-authenticated identity in the same
-- transaction as the application query; passwords alone confer no web access.

begin;

do $roles$
declare
  role_name text;
  role_state record;
begin
  foreach role_name in array array[
    'superii_web_backend',
    'superii_payment_backend',
    'superii_publishing_backend',
    'superii_runtime_backend'
  ] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'create role %I nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
        role_name
      );
    end if;
    select rolinherit, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls
      into role_state
      from pg_roles where rolname = role_name;
    if role_state.rolinherit or role_state.rolcanlogin or role_state.rolsuper
      or role_state.rolcreatedb or role_state.rolcreaterole
      or role_state.rolreplication or role_state.rolbypassrls then
      raise exception '% has a forbidden cluster capability', role_name;
    end if;
  end loop;
end
$roles$;

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on all tables in schema app_private from public;
revoke all on all sequences in schema app_private from public;
revoke execute on all functions in schema app_private from public;
alter default privileges in schema app_private revoke all on tables from public;
alter default privileges in schema app_private revoke all on sequences from public;
alter default privileges in schema app_private revoke execute on functions from public;

create table if not exists app_private.context_secrets (
  service text not null check (service in ('web', 'payment', 'publishing')),
  key_id text not null check (key_id ~ '^[A-Za-z0-9._:-]{8,80}$'),
  secret text not null check (char_length(secret) between 32 and 256),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  primary key (service, key_id)
);

create unlogged table if not exists app_private.request_contexts (
  backend_pid integer not null,
  transaction_id text not null,
  service text not null,
  key_id text not null,
  actor_kind text not null,
  clerk_user_id text,
  clerk_organization_id text,
  profile_id uuid,
  organization_id uuid,
  agent_identity_id uuid,
  social_agent_id uuid,
  is_admin boolean not null default false,
  nonce uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (backend_pid, transaction_id),
  unique (service, nonce)
);
create index if not exists request_contexts_expiry_idx
  on app_private.request_contexts (expires_at);

create or replace function app.begin_request_context(
  p_service text,
  p_key_id text,
  p_actor_kind text,
  p_clerk_user_id text,
  p_clerk_organization_id text,
  p_profile_id uuid,
  p_organization_id uuid,
  p_agent_identity_id uuid,
  p_social_agent_id uuid,
  p_is_admin boolean,
  p_expires_at bigint,
  p_nonce uuid,
  p_signature text
)
returns void
language plpgsql
security definer
set search_path = app_private, app, pg_catalog, public
as $context$
declare
  secret_value text;
  expected_signature text;
  signed_payload text;
  context_expires_at timestamptz := to_timestamp(p_expires_at);
  required_role text;
begin
  required_role := case p_service
    when 'web' then 'superii_web_backend'
    when 'payment' then 'superii_payment_backend'
    when 'publishing' then 'superii_publishing_backend'
    else null
  end;
  if required_role is null
    or not pg_has_role(session_user, required_role, 'member') then
    raise exception 'database_context_service_forbidden' using errcode = '42501';
  end if;
  if p_key_id is null or p_nonce is null
    or p_signature !~ '^[a-f0-9]{64}$'
    or context_expires_at < clock_timestamp() - interval '5 seconds'
    or context_expires_at > clock_timestamp() + interval '60 seconds' then
    raise exception 'database_context_invalid' using errcode = '28000';
  end if;
  if strpos(coalesce(p_clerk_user_id, ''), E'\n') > 0
    or strpos(coalesce(p_clerk_organization_id, ''), E'\n') > 0 then
    raise exception 'database_context_invalid' using errcode = '28000';
  end if;

  if p_service = 'web' and p_actor_kind not in ('public','clerk','agent','scoped','social') then
    raise exception 'database_context_actor_forbidden' using errcode = '42501';
  elsif p_service = 'payment' and p_actor_kind not in ('public','clerk','commerce','payment-webhook') then
    raise exception 'database_context_actor_forbidden' using errcode = '42501';
  elsif p_service = 'publishing' and p_actor_kind <> 'publishing-oidc' then
    raise exception 'database_context_actor_forbidden' using errcode = '42501';
  end if;
  if p_actor_kind = 'public' and (
    p_clerk_user_id is not null or p_clerk_organization_id is not null
    or p_profile_id is not null or p_organization_id is not null
    or p_agent_identity_id is not null or p_social_agent_id is not null
    or p_is_admin
  ) then
    raise exception 'database_context_public_identity_forbidden' using errcode = '42501';
  elsif p_actor_kind = 'clerk' and nullif(btrim(p_clerk_user_id), '') is null then
    raise exception 'database_context_clerk_identity_required' using errcode = '42501';
  elsif p_actor_kind = 'agent' and (
    p_profile_id is null or p_organization_id is null or p_agent_identity_id is null
  ) then
    raise exception 'database_context_agent_identity_required' using errcode = '42501';
  elsif p_actor_kind = 'scoped' and p_profile_id is null then
    raise exception 'database_context_scoped_identity_required' using errcode = '42501';
  elsif p_actor_kind = 'social' and (p_profile_id is null or p_social_agent_id is null) then
    raise exception 'database_context_social_identity_required' using errcode = '42501';
  elsif p_actor_kind = 'commerce' and p_profile_id is null then
    raise exception 'database_context_commerce_identity_required' using errcode = '42501';
  end if;

  select context_secret.secret into secret_value
  from app_private.context_secrets as context_secret
  where context_secret.service = p_service and context_secret.key_id = p_key_id
    and context_secret.revoked_at is null
    and (context_secret.expires_at is null or context_secret.expires_at > clock_timestamp());
  if secret_value is null then
    raise exception 'database_context_key_unavailable' using errcode = '28000';
  end if;

  signed_payload := array_to_string(array[
    'superii-db-context-v1', p_service, p_key_id, p_actor_kind,
    coalesce(p_clerk_user_id, ''), coalesce(p_clerk_organization_id, ''),
    coalesce(p_profile_id::text, ''), coalesce(p_organization_id::text, ''),
    coalesce(p_agent_identity_id::text, ''), coalesce(p_social_agent_id::text, ''),
    case when p_is_admin then '1' else '0' end,
    p_expires_at::text, p_nonce::text
  ], E'\n');
  expected_signature := encode(public.hmac(signed_payload, secret_value, 'sha256'), 'hex');
  if expected_signature <> p_signature then
    raise exception 'database_context_signature_invalid' using errcode = '28000';
  end if;

  delete from app_private.request_contexts
  where expires_at < clock_timestamp()
     or (backend_pid = pg_backend_pid() and transaction_id <> pg_current_xact_id()::text);
  insert into app_private.request_contexts (
    backend_pid, transaction_id, service, key_id, actor_kind,
    clerk_user_id, clerk_organization_id, profile_id, organization_id,
    agent_identity_id, social_agent_id, is_admin, nonce, expires_at
  ) values (
    pg_backend_pid(), pg_current_xact_id()::text, p_service, p_key_id, p_actor_kind,
    p_clerk_user_id, p_clerk_organization_id, p_profile_id, p_organization_id,
    p_agent_identity_id, p_social_agent_id, p_is_admin, p_nonce, context_expires_at
  );
end
$context$;

revoke all on function app.begin_request_context(
  text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,bigint,uuid,text
) from public;
grant execute on function app.begin_request_context(
  text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,bigint,uuid,text
) to superii_web_backend, superii_payment_backend, superii_publishing_backend;

create or replace function app.context_is_verified()
returns boolean language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select exists (
    select 1 from app_private.request_contexts
    where backend_pid = pg_backend_pid()
      and transaction_id = pg_current_xact_id()::text
      and expires_at >= clock_timestamp()
  )
$$;

create or replace function app.current_context_service()
returns text language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select service from app_private.request_contexts
  where backend_pid = pg_backend_pid()
    and transaction_id = pg_current_xact_id()::text
    and expires_at >= clock_timestamp()
$$;

create or replace function app.current_actor_kind()
returns text language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select actor_kind from app_private.request_contexts
  where backend_pid = pg_backend_pid()
    and transaction_id = pg_current_xact_id()::text
    and expires_at >= clock_timestamp()
$$;

create or replace function app.current_clerk_user_id()
returns text language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select clerk_user_id from app_private.request_contexts
  where backend_pid = pg_backend_pid()
    and transaction_id = pg_current_xact_id()::text
    and expires_at >= clock_timestamp()
$$;

create or replace function app.current_profile_id()
returns uuid language sql stable security definer
set search_path = app_private, app, pg_catalog as $$
  select coalesce(context.profile_id, profile.id)
  from app_private.request_contexts context
  left join app.profiles profile on profile.clerk_user_id = context.clerk_user_id
  where context.backend_pid = pg_backend_pid()
    and context.transaction_id = pg_current_xact_id()::text
    and context.expires_at >= clock_timestamp()
$$;

create or replace function app.current_agent_identity_id()
returns uuid language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select agent_identity_id from app_private.request_contexts
  where backend_pid = pg_backend_pid()
    and transaction_id = pg_current_xact_id()::text
    and expires_at >= clock_timestamp()
$$;

create or replace function app.current_social_agent_id()
returns uuid language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select social_agent_id from app_private.request_contexts
  where backend_pid = pg_backend_pid()
    and transaction_id = pg_current_xact_id()::text
    and expires_at >= clock_timestamp()
$$;

create or replace function app.context_is_admin()
returns boolean language sql stable security definer
set search_path = app_private, pg_catalog as $$
  select coalesce((select is_admin from app_private.request_contexts
    where backend_pid = pg_backend_pid()
      and transaction_id = pg_current_xact_id()::text
      and expires_at >= clock_timestamp()), false)
$$;

do $helpers$
declare function_name text;
begin
  foreach function_name in array array[
    'context_is_verified','current_context_service','current_actor_kind',
    'current_clerk_user_id','current_profile_id','current_agent_identity_id',
    'current_social_agent_id','context_is_admin'
  ] loop
    execute format('revoke all on function app.%I() from public', function_name);
    execute format(
      'grant execute on function app.%I() to superii_web_backend, superii_payment_backend, superii_publishing_backend',
      function_name
    );
  end loop;
end
$helpers$;

commit;

begin;

create or replace procedure app_private.install_least_privilege_policies()
language plpgsql
security definer
set search_path = app_private, app, pg_catalog
as $policies$
declare
  table_name text;
  web_mutable constant text[] := array[
    'activity_events','agent_access_tokens','agent_action_receipts',
    'agent_contribution_jobs','agent_contribution_submissions','agent_events',
    'agent_identities','agent_subscriptions','agent_traces',
    'assistant_memory_items','assistant_memory_preferences','assistant_messages',
    'assistant_threads','assistant_usage_ledger','audit_events',
    'bridge_import_items','bridge_import_jobs','bridge_oauth_states',
    'bridge_sync_subscriptions','collection_items','collections',
    'discussion_comments','discussion_events','discussions','external_identities',
    'follows','likes','namespace_claims','notifications','organization_members',
    'organizations','paper_repository_links','papers','posts','profile_likes',
    'profiles','proposal_reports','proposal_status_history','proposal_votes',
    'proposals','reactions','repositories','repository_branches',
    'repository_downloads','repository_files','repository_relationships',
    'repository_releases','repository_revisions','repository_sources',
    'repository_tags','repository_uploads','repository_watchers',
    'resource_group_members','resource_group_repositories','resource_groups',
    'robot_component_claims','robot_hardware','robot_versions','robots',
    'scoped_access_tokens','service_account_roles','service_accounts',
    'social_action_receipts','social_agents','social_comments','social_credentials',
    'social_events','social_follows','social_pairing_codes','social_posts',
    'social_votes','transparency_creator_responses',
    'transparency_evidence_submissions','transparency_report_saves',
    'transparency_report_watches','transparency_reports',
    'transparency_repository_claims','trusted_publishers','waitlist'
  ];
  payment_tables constant text[] := array[
    'agent_identities','audit_events','commerce_delegations','commerce_orders',
    'commerce_quote_requests','commerce_receipts','contact_submissions',
    'fame_slots','highlight_campaigns','organization_members','organizations',
    'participation_orders','payment_orders','plans','profiles','repositories',
    'repository_branches','repository_revisions','request_limits','subscriptions'
  ];
  payment_mutable constant text[] := array[
    'audit_events','commerce_delegations','commerce_orders',
    'commerce_quote_requests','commerce_receipts','contact_submissions',
    'fame_slots','highlight_campaigns','participation_orders','payment_orders',
    'request_limits','subscriptions'
  ];
  publishing_tables constant text[] := array[
    'audit_events','repositories','scoped_access_tokens','trusted_publishers'
  ];
  publishing_mutable constant text[] := array[
    'audit_events','scoped_access_tokens','trusted_publishers'
  ];
  runtime_tables constant text[] := array[
    'bridge_events','bridge_import_items','bridge_import_jobs',
    'bridge_sync_subscriptions','cas_integrity_events','external_identities',
    'notebook_execution_sessions','profiles','repositories','repository_branches',
    'repository_downloads','repository_file_inspections','repository_files',
    'repository_revision_analyses','repository_revisions','repository_sources',
    'repository_uploads','runtime_benchmark_records','runtime_model_instances'
  ];
begin
  revoke all on schema app from superii_web_backend, superii_payment_backend,
    superii_publishing_backend, superii_runtime_backend;
  revoke all on all tables in schema app from superii_web_backend,
    superii_payment_backend, superii_publishing_backend, superii_runtime_backend;
  revoke all on all sequences in schema app from superii_web_backend,
    superii_payment_backend, superii_publishing_backend, superii_runtime_backend;
  revoke execute on all functions in schema app from superii_web_backend,
    superii_payment_backend, superii_publishing_backend, superii_runtime_backend;

  grant usage on schema app to superii_web_backend, superii_payment_backend,
    superii_publishing_backend, superii_runtime_backend;

  for table_name in
    select class.relname
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'app' and class.relkind in ('r','p')
    order by class.relname
  loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('drop policy if exists superii_web_tenant_select on app.%I', table_name);
    execute format(
      'create policy superii_web_tenant_select on app.%I for select to superii_web_backend using (app.tenant_can_read(%L, to_jsonb(%I.*)))',
      table_name, table_name, table_name
    );
    execute format('grant select on app.%I to superii_web_backend', table_name);

    if table_name = any(web_mutable) then
      execute format('drop policy if exists superii_web_tenant_insert on app.%I', table_name);
      execute format('drop policy if exists superii_web_tenant_update on app.%I', table_name);
      execute format('drop policy if exists superii_web_tenant_delete on app.%I', table_name);
      execute format(
        'create policy superii_web_tenant_insert on app.%I for insert to superii_web_backend with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'insert'
      );
      execute format(
        'create policy superii_web_tenant_update on app.%I for update to superii_web_backend using (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L)) with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'update', table_name, table_name, 'update'
      );
      execute format(
        'create policy superii_web_tenant_delete on app.%I for delete to superii_web_backend using (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'delete'
      );
      execute format('grant insert, update, delete on app.%I to superii_web_backend', table_name);
    end if;

    if table_name = any(payment_tables) then
      execute format('drop policy if exists superii_payment_tenant_select on app.%I', table_name);
      execute format(
        'create policy superii_payment_tenant_select on app.%I for select to superii_payment_backend using (app.tenant_can_read(%L, to_jsonb(%I.*)) or (app.current_actor_kind() = %L and app.current_context_service() = %L))',
        table_name, table_name, table_name, 'payment-webhook', 'payment'
      );
      execute format('grant select on app.%I to superii_payment_backend', table_name);
    end if;
    if table_name = any(payment_mutable) then
      execute format('drop policy if exists superii_payment_tenant_insert on app.%I', table_name);
      execute format('drop policy if exists superii_payment_tenant_update on app.%I', table_name);
      execute format('drop policy if exists superii_payment_tenant_delete on app.%I', table_name);
      execute format(
        'create policy superii_payment_tenant_insert on app.%I for insert to superii_payment_backend with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'insert'
      );
      execute format(
        'create policy superii_payment_tenant_update on app.%I for update to superii_payment_backend using (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L)) with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'update', table_name, table_name, 'update'
      );
      execute format(
        'create policy superii_payment_tenant_delete on app.%I for delete to superii_payment_backend using (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'delete'
      );
      execute format('grant insert, update, delete on app.%I to superii_payment_backend', table_name);
    end if;

    if table_name = any(publishing_tables) then
      execute format('drop policy if exists superii_publishing_service_select on app.%I', table_name);
      execute format(
        'create policy superii_publishing_service_select on app.%I for select to superii_publishing_backend using (app.current_actor_kind() = %L and app.current_context_service() = %L)',
        table_name, 'publishing-oidc', 'publishing'
      );
      execute format('grant select on app.%I to superii_publishing_backend', table_name);
    end if;
    if table_name = any(publishing_mutable) then
      execute format('drop policy if exists superii_publishing_service_insert on app.%I', table_name);
      execute format('drop policy if exists superii_publishing_service_update on app.%I', table_name);
      execute format(
        'create policy superii_publishing_service_insert on app.%I for insert to superii_publishing_backend with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'insert'
      );
      execute format(
        'create policy superii_publishing_service_update on app.%I for update to superii_publishing_backend using (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L)) with check (app.tenant_can_mutate(%L, to_jsonb(%I.*), %L))',
        table_name, table_name, table_name, 'update', table_name, table_name, 'update'
      );
      execute format('grant insert, update on app.%I to superii_publishing_backend', table_name);
    end if;

    if table_name = any(runtime_tables) then
      execute format('drop policy if exists superii_runtime_service_all on app.%I', table_name);
      execute format(
        'create policy superii_runtime_service_all on app.%I for all to superii_runtime_backend using (true) with check (true)',
        table_name
      );
      execute format('grant select, insert, update, delete on app.%I to superii_runtime_backend', table_name);
    end if;
  end loop;

  grant usage, select on all sequences in schema app
    to superii_web_backend, superii_payment_backend, superii_publishing_backend,
       superii_runtime_backend;
end
$policies$;

-- Invoker functions remain constrained by the caller's table grants and RLS.
do $function_grants$
declare function_record record;
begin
  for function_record in
    select procedure.oid, pg_get_function_identity_arguments(procedure.oid) as arguments,
           procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app' and procedure.prokind = 'f'
      and not procedure.prosecdef
  loop
    execute format('grant execute on function app.%I(%s) to superii_web_backend, superii_payment_backend, superii_runtime_backend',
      function_record.proname, function_record.arguments);
  end loop;
end
$function_grants$;

-- Public signing material and immutable decisions are deliberately readable;
-- private keys never enter PostgreSQL.
drop policy if exists publication_keys_public_read on app.publication_keys;
create policy publication_keys_public_read on app.publication_keys
  for select to superii_web_backend using (enabled);

comment on role superii_web_backend is
  'NOLOGIN Super ii website bundle; signed request context and RLS required';
comment on role superii_payment_backend is
  'NOLOGIN Super ii payment bundle; signed request context and payment tables only';
comment on role superii_publishing_backend is
  'NOLOGIN trusted-publishing exchange bundle; OIDC route and bounded token minting only';
comment on role superii_runtime_backend is
  'NOLOGIN local runtime and bridge bundle; repository pipeline objects only';

commit;

begin;

create or replace function app.consume_scoped_access_token(
  p_token_hash text,
  p_scope text,
  p_repository_id uuid
)
returns table(
  id uuid,
  created_by_profile_id uuid,
  trusted_publisher_id uuid,
  service_account_id uuid
)
language plpgsql
security definer
set search_path = app, pg_catalog
as $scoped$
declare
  token_record record;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope not in ('repository:read','repository:upload','repository:commit','repository:submit','repository:trace')
    or p_repository_id is null then
    return;
  end if;
  select access_token.id, access_token.created_by_profile_id,
         access_token.trusted_publisher_id, access_token.service_account_id
    into token_record
    from app.scoped_access_tokens access_token
    left join app.trusted_publishers publisher
      on publisher.id = access_token.trusted_publisher_id
    left join app.service_accounts service_account
      on service_account.id = access_token.service_account_id
    where access_token.token_hash = p_token_hash
      and access_token.repository_id = p_repository_id
      and access_token.revoked_at is null
      and access_token.expires_at > now()
      and access_token.scopes ? p_scope
      and (
        (publisher.id is not null and publisher.enabled)
        or (service_account.id is not null and service_account.disabled_at is null)
      )
    for update of access_token;
  if token_record.id is null then return; end if;
  update app.scoped_access_tokens access_token
    set last_used_at = now() where access_token.id = token_record.id;
  if token_record.trusted_publisher_id is not null then
    update app.trusted_publishers publisher
      set last_used_at = now()
      where publisher.id = token_record.trusted_publisher_id;
  end if;
  return query select token_record.id, token_record.created_by_profile_id,
    token_record.trusted_publisher_id, token_record.service_account_id;
end
$scoped$;

create or replace function app.consume_commerce_delegation(
  p_token_hash text,
  p_scope text
)
returns table(
  id uuid,
  profile_id uuid,
  agent_identity_id uuid,
  scopes text[],
  allowed_products text[],
  organization_id uuid,
  repository_id uuid,
  max_order_amount_cents integer,
  total_limit_cents integer,
  authorized_amount_cents integer,
  max_orders integer,
  orders_created integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = app, pg_catalog
as $commerce$
declare
  delegation app.commerce_delegations;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope not in ('commerce:orders:create','commerce:orders:read','commerce:receipts:read') then
    return;
  end if;
  select record.* into delegation
  from app.commerce_delegations record
  where record.token_hash = p_token_hash
    and record.revoked_at is null
    and record.expires_at > now()
    and p_scope = any(record.scopes)
  for update;
  if delegation.id is null then return; end if;
  update app.commerce_delegations record
    set last_used_at = now() where record.id = delegation.id;
  return query select delegation.id, delegation.profile_id,
    delegation.agent_identity_id, delegation.scopes, delegation.allowed_products,
    delegation.organization_id, delegation.repository_id,
    delegation.max_order_amount_cents, delegation.total_limit_cents,
    delegation.authorized_amount_cents, delegation.max_orders,
    delegation.orders_created, delegation.expires_at;
end
$commerce$;

alter function app.consume_agent_access_token(text,text,uuid) security definer;
alter function app.consume_social_credential(text,text) security definer;
alter function app.consume_social_pairing_code(text,text,text,text[],timestamptz) security definer;
alter function app.submit_contact(text,text,text,text,text,text) security definer;
alter function app.consume_request_limit(text,text,integer,integer) security definer;
alter function app.record_highlight_event(uuid,text,text) security definer;
alter function app.record_robot_discovery(text,text,text) security definer;
alter function app.record_transparency_discovery(text,text,text) security definer;

do $gateway_grants$
declare signature text;
begin
  foreach signature in array array[
    'app.consume_scoped_access_token(text,text,uuid)',
    'app.consume_agent_access_token(text,text,uuid)',
    'app.consume_social_credential(text,text)',
    'app.consume_social_pairing_code(text,text,text,text[],timestamptz)',
    'app.submit_contact(text,text,text,text,text,text)',
    'app.consume_request_limit(text,text,integer,integer)',
    'app.record_highlight_event(uuid,text,text)',
    'app.record_robot_discovery(text,text,text)',
    'app.record_transparency_discovery(text,text,text)'
  ] loop
    execute 'revoke all on function ' || signature || ' from public';
    execute 'grant execute on function ' || signature || ' to superii_web_backend';
  end loop;
  revoke all on function app.consume_commerce_delegation(text,text) from public;
  grant execute on function app.consume_commerce_delegation(text,text) to superii_payment_backend;
end
$gateway_grants$;

commit;

begin;

-- Public proposal pages and vote creation may finalize only the immediately
-- preceding UTC month. Running as the migration owner avoids giving callers
-- direct INSERT access to permanent leader badges.
create or replace function app.finalize_proposal_leaderboard(p_award_month date)
returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $leaderboard$
declare
  inserted_count integer := 0;
  month_start date := date_trunc('month', p_award_month)::date;
  allowed_month date := date_trunc('month', current_date - interval '1 month')::date;
begin
  if month_start <> allowed_month then
    raise exception 'proposal_leaderboard_month_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('proposal-leaders:' || month_start::text, 0));
  if exists (select 1 from app.proposal_leader_badges where award_month = month_start) then
    return 0;
  end if;

  with proposal_scores as (
    select proposal.id as proposal_id, proposal.proposer_profile_id,
           count(vote.id)::integer as valid_human_votes
    from app.proposals proposal
    join app.proposal_votes vote on vote.proposal_id = proposal.id
      and vote.vote_kind = 'human' and vote.risk_state = 'valid'
      and vote.created_at >= month_start
      and vote.created_at < month_start + interval '1 month'
    where proposal.status <> 'removed'
    group by proposal.id, proposal.proposer_profile_id
  ), profile_scores as (
    select proposer_profile_id, sum(valid_human_votes)::integer as valid_human_votes
    from proposal_scores group by proposer_profile_id
  ), ranked as (
    select profile_scores.*,
           row_number() over (order by valid_human_votes desc, proposer_profile_id)::smallint as rank
    from profile_scores
  )
  insert into app.proposal_leader_badges (
    profile_id, award_month, rank, winning_proposal_id, valid_human_votes
  )
  select ranked.proposer_profile_id, month_start, ranked.rank,
         winner.proposal_id, ranked.valid_human_votes
  from ranked
  cross join lateral (
    select proposal_id from proposal_scores
    where proposer_profile_id = ranked.proposer_profile_id
    order by valid_human_votes desc, proposal_id limit 1
  ) winner
  where ranked.rank <= 3
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$leaderboard$;
revoke all on function app.finalize_proposal_leaderboard(date) from public;

-- The public reputation view exposes aggregates only for explicitly public,
-- active agents. It never exposes receipt or submission rows.
create or replace view app.agent_reputation with (security_barrier=true) as
select
  identity.id as agent_identity_id,
  identity.handle,
  count(distinct submission.id) filter (where submission.status = 'accepted')::integer as accepted_contributions,
  count(distinct submission.id) filter (where submission.status = 'rejected')::integer as rejected_contributions,
  count(distinct receipt.id) filter (where receipt.status = 'succeeded')::integer as successful_actions,
  count(distinct receipt.id) filter (where receipt.status in ('failed', 'rejected'))::integer as unsuccessful_actions,
  greatest(
    0,
    10 * count(distinct submission.id) filter (where submission.status = 'accepted')
      - 2 * count(distinct submission.id) filter (where submission.status = 'rejected')
  )::integer as reputation_score
from app.agent_identities identity
left join app.agent_contribution_submissions submission
  on submission.agent_identity_id = identity.id
left join app.agent_action_receipts receipt
  on receipt.agent_identity_id = identity.id
where identity.is_public and identity.status = 'active'
group by identity.id, identity.handle;

create or replace function app.can_access_organization(p_organization_id uuid, p_write boolean default false)
returns boolean language sql stable security definer
set search_path = app_private, app, pg_catalog as $$
  select coalesce(p_organization_id is not null and (
    exists (
      select 1 from app_private.request_contexts context
      where context.backend_pid = pg_backend_pid()
        and context.transaction_id = pg_current_xact_id()::text
        and context.expires_at >= clock_timestamp()
        and context.organization_id = p_organization_id
    )
    or exists (
      select 1 from app.organizations organization
      join app_private.request_contexts context
        on context.clerk_organization_id = organization.clerk_organization_id
      where organization.id = p_organization_id
        and context.backend_pid = pg_backend_pid()
        and context.transaction_id = pg_current_xact_id()::text
        and context.expires_at >= clock_timestamp()
    )
    or exists (
      select 1 from app.organization_members member
      where member.organization_id = p_organization_id
        and member.profile_id = app.current_profile_id()
        and (not p_write or member.role in ('owner','admin','maintainer'))
    )
  ), false)
$$;

create or replace function app.can_access_repository(p_repository_id uuid, p_write boolean default false)
returns boolean language sql stable security definer
set search_path = app, pg_catalog as $$
  select coalesce(exists (
    select 1 from app.repositories repository
    where repository.id = p_repository_id
      and (
        (not p_write and repository.visibility = 'public' and repository.status = 'published')
        or repository.owner_profile_id = app.current_profile_id()
        or app.can_access_organization(repository.owner_organization_id, p_write)
      )
  ), false)
$$;

create or replace function app.tenant_can_read(p_table text, p_row jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = app_private, app, pg_catalog
as $read$
declare
  profile uuid := app.current_profile_id();
  agent uuid := app.current_agent_identity_id();
  social_agent uuid := app.current_social_agent_id();
  candidate uuid;
  key text;
begin
  if not app.context_is_verified() then return false; end if;
  if app.context_is_admin() then return true; end if;

  if p_table in ('contact_submissions','waitlist','request_limits','audit_events','cas_integrity_events') then
    return false;
  end if;
  if p_table = 'publication_keys' then
    return coalesce((p_row->>'enabled')::boolean, false);
  end if;
  if p_table = 'profiles' then
    return coalesce((p_row->>'is_public')::boolean, false)
      or profile = nullif(p_row->>'id','')::uuid;
  elsif p_table = 'organizations' then
    return coalesce((p_row->>'is_public')::boolean, false)
      or app.can_access_organization((p_row->>'id')::uuid, false);
  elsif p_table = 'organization_members' then
    return profile = nullif(p_row->>'profile_id','')::uuid
      or app.can_access_organization((p_row->>'organization_id')::uuid, false)
      or exists (
        select 1 from app.organizations organization
        where organization.id = (p_row->>'organization_id')::uuid
          and organization.is_public
      );
  elsif p_table = 'plans' then
    return coalesce((p_row->>'is_public')::boolean, false);
  elsif p_table = 'subscriptions' then
    return nullif(p_row->>'clerk_user_id','') = app.current_clerk_user_id()
      or nullif(p_row->>'clerk_organization_id','') = (
        select context.clerk_organization_id
        from app_private.request_contexts context
        where context.backend_pid = pg_backend_pid()
          and context.transaction_id = pg_current_xact_id()::text
          and context.expires_at >= clock_timestamp()
      )
      or app.can_access_organization(
        nullif(p_row->>'organization_id','')::uuid,
        false
      );
  elsif p_table = 'repositories' then
    return (
      coalesce(p_row->>'visibility', '') = 'public'
      and coalesce(p_row->>'status', '') = 'published'
    )
      or profile = nullif(p_row->>'owner_profile_id','')::uuid
      or app.can_access_organization(
        nullif(p_row->>'owner_organization_id','')::uuid,
        false
      );
  elsif p_table = 'proposal_votes' then
    return coalesce(p_row->>'risk_state','') = 'valid'
      or profile in (
        nullif(p_row->>'voter_profile_id','')::uuid,
        nullif(p_row->>'operator_profile_id','')::uuid
      )
      or social_agent = nullif(p_row->>'voter_social_agent_id','')::uuid;
  elsif p_table = 'fame_slots' then
    return coalesce(p_row->>'status','') in ('open','active','retired')
      or profile = nullif(p_row->>'profile_id','')::uuid;
  elsif p_table = 'assistant_messages' then
    return exists (
      select 1 from app.assistant_threads thread
      where thread.id = (p_row->>'thread_id')::uuid and thread.profile_id = profile
    );
  elsif p_table = 'bridge_events' then
    return exists (
      select 1 from app.bridge_import_jobs job
      where job.id = (p_row->>'job_id')::uuid and job.profile_id = profile
    );
  elsif p_table = 'bridge_import_items' then
    return exists (
      select 1 from app.bridge_import_jobs job
      where job.id = (p_row->>'job_id')::uuid and job.profile_id = profile
    ) or app.can_access_repository((p_row->>'repository_id')::uuid, false);
  elsif p_table = 'collection_items' then
    return exists (
      select 1 from app.collections collection
      where collection.id = (p_row->>'collection_id')::uuid
        and collection.owner_profile_id = profile
    );
  elsif p_table in ('discussion_comments','discussion_events') then
    return exists (
      select 1 from app.discussions discussion
      where discussion.id = (p_row->>'discussion_id')::uuid
        and app.can_access_repository(discussion.repository_id, false)
    );
  elsif p_table = 'highlight_events' then
    return exists (
      select 1 from app.highlight_campaigns campaign
      where campaign.id = (p_row->>'campaign_id')::uuid
        and campaign.profile_id = profile
    );
  elsif p_table = 'paper_repository_links' then
    return exists (
      select 1 from app.papers paper
      where paper.id = (p_row->>'paper_id')::uuid and paper.owner_profile_id = profile
    ) or app.can_access_repository((p_row->>'repository_id')::uuid, false);
  elsif p_table in ('proposal_status_history','proposal_votes','proposal_reports') then
    return exists (
      select 1 from app.proposals proposal
      where proposal.id = (p_row->>'proposal_id')::uuid
        and proposal.proposer_profile_id = profile
    );
  elsif p_table = 'repository_file_inspections' then
    return exists (
      select 1 from app.repository_files file
      where file.id = (p_row->>'repository_file_id')::uuid
        and app.can_access_repository(file.repository_id, false)
    );
  elsif p_table = 'service_account_roles' then
    return exists (
      select 1 from app.service_accounts account
      where account.id = (p_row->>'service_account_id')::uuid
        and app.can_access_organization(account.organization_id, false)
    );
  elsif p_table in ('social_comments','social_posts') then
    candidate := nullif(p_row->>'social_agent_id','')::uuid;
    return candidate = social_agent or exists (
      select 1 from app.social_agents account
      where account.id = candidate and account.owner_profile_id = profile
    );
  elsif p_table = 'social_events' then
    return social_agent in (
      nullif(p_row->>'recipient_agent_id','')::uuid,
      nullif(p_row->>'actor_agent_id','')::uuid
    );
  elsif p_table = 'social_follows' then
    return social_agent in (
      nullif(p_row->>'follower_agent_id','')::uuid,
      nullif(p_row->>'followed_agent_id','')::uuid
    );
  elsif p_table = 'social_votes' then
    return social_agent = nullif(p_row->>'voter_agent_id','')::uuid;
  elsif p_table = 'proposal_leader_badges' then
    return profile = nullif(p_row->>'profile_id','')::uuid;
  elsif p_table = 'publication_decisions' then
    return app.can_access_repository((p_row->>'repository_id')::uuid, false);
  elsif p_table = 'repository_relationships' then
    return app.can_access_repository((p_row->>'source_repository_id')::uuid, false)
      and app.can_access_repository((p_row->>'target_repository_id')::uuid, false);
  elsif p_table = 'resource_group_members' then
    return profile = nullif(p_row->>'profile_id','')::uuid
      or exists (
        select 1 from app.resource_groups group_record
        where group_record.id = (p_row->>'resource_group_id')::uuid
          and app.can_access_organization(group_record.organization_id, false)
      );
  elsif p_table = 'resource_group_repositories' then
    return app.can_access_repository((p_row->>'repository_id')::uuid, false)
      or exists (
        select 1 from app.resource_groups group_record
        where group_record.id = (p_row->>'resource_group_id')::uuid
          and app.can_access_organization(group_record.organization_id, false)
      );
  elsif p_table = 'robot_versions' then
    return exists (
      select 1 from app.robots robot
      where robot.id = (p_row->>'robot_id')::uuid
        and (
          robot.owner_profile_id = profile
          or app.can_access_organization(robot.owner_organization_id, false)
        )
    );
  end if;

  foreach key in array array[
    'profile_id','owner_profile_id','author_profile_id','proposer_profile_id',
    'created_by_profile_id','actor_profile_id','follower_profile_id',
    'followed_profile_id','liker_profile_id','liked_profile_id',
    'uploader_profile_id','operator_profile_id','submitted_by_profile_id',
    'reporter_profile_id','voter_profile_id','downloader_profile_id',
    'destination_profile_id'
  ] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if profile is not null and candidate = profile then return true; end if;
  end loop;
  foreach key in array array[
    'organization_id','owner_organization_id','operator_organization_id',
    'sponsor_organization_id'
  ] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if candidate is not null and app.can_access_organization(candidate, false) then return true; end if;
  end loop;
  foreach key in array array['repository_id','source_repository_id','target_repository_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if candidate is not null and app.can_access_repository(candidate, false) then return true; end if;
  end loop;
  foreach key in array array['agent_identity_id','claimed_by_agent_id','created_by_agent_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if agent is not null and candidate = agent then return true; end if;
  end loop;
  foreach key in array array['social_agent_id','voter_agent_id','follower_agent_id','recipient_agent_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if social_agent is not null and candidate = social_agent then return true; end if;
  end loop;
  return false;
end
$read$;

create or replace function app.tenant_can_mutate(p_table text, p_row jsonb, p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path = app_private, app, pg_catalog
as $write$
declare
  profile uuid := app.current_profile_id();
  agent uuid := app.current_agent_identity_id();
  social_agent uuid := app.current_social_agent_id();
  candidate uuid;
  key text;
begin
  if not app.context_is_verified() or p_operation not in ('insert','update','delete') then
    return false;
  end if;
  if app.context_is_admin() then return true; end if;
  if app.current_context_service() = 'payment'
    and app.current_actor_kind() = 'payment-webhook'
    and p_table in (
      'payment_orders','participation_orders','subscriptions','fame_slots',
      'highlight_campaigns','commerce_orders','commerce_receipts'
    ) then
    return true;
  end if;
  if app.current_context_service() = 'publishing'
    and app.current_actor_kind() = 'publishing-oidc'
    and (
      (p_table = 'scoped_access_tokens' and p_operation = 'insert')
      or (p_table = 'trusted_publishers' and p_operation = 'update')
      or (p_table = 'audit_events' and p_operation = 'insert')
    ) then
    return true;
  end if;

  if p_table = 'profiles' then
    return profile = nullif(p_row->>'id','')::uuid
      or (
        p_operation = 'insert'
        and profile is null
        and nullif(p_row->>'clerk_user_id','') = app.current_clerk_user_id()
      );
  elsif p_table = 'organizations' then
    return (p_operation = 'insert' and profile is not null)
      or app.can_access_organization((p_row->>'id')::uuid, true);
  elsif p_table = 'organization_members' then
    return app.can_access_organization((p_row->>'organization_id')::uuid, true)
      or (
        p_operation = 'insert'
        and profile = (p_row->>'profile_id')::uuid
        and not exists (
          select 1 from app.organization_members member
          where member.organization_id = (p_row->>'organization_id')::uuid
        )
      );
  elsif p_table = 'proposals' then
    return (p_operation = 'insert' and profile = (p_row->>'proposer_profile_id')::uuid);
  elsif p_table = 'proposal_votes' then
    return p_operation = 'insert' and (
      profile = nullif(p_row->>'voter_profile_id','')::uuid
      or social_agent = nullif(p_row->>'voter_social_agent_id','')::uuid
    );
  elsif p_table = 'proposal_reports' then
    return p_operation = 'insert' and profile = (p_row->>'reporter_profile_id')::uuid;
  elsif p_table in ('proposal_status_history','proposal_leader_badges') then
    return false;
  elsif p_table = 'assistant_messages' then
    return exists (
      select 1 from app.assistant_threads thread
      where thread.id = (p_row->>'thread_id')::uuid and thread.profile_id = profile
    );
  elsif p_table = 'bridge_events' then
    return exists (
      select 1 from app.bridge_import_jobs job
      where job.id = (p_row->>'job_id')::uuid and job.profile_id = profile
    );
  elsif p_table = 'bridge_import_items' then
    return exists (
      select 1 from app.bridge_import_jobs job
      where job.id = (p_row->>'job_id')::uuid and job.profile_id = profile
    );
  elsif p_table = 'collection_items' then
    return exists (
      select 1 from app.collections collection
      where collection.id = (p_row->>'collection_id')::uuid
        and collection.owner_profile_id = profile
    );
  elsif p_table in ('discussion_comments','discussion_events') then
    return exists (
      select 1 from app.discussions discussion
      where discussion.id = (p_row->>'discussion_id')::uuid
        and (
          discussion.author_profile_id = profile
          or app.can_access_repository(discussion.repository_id, true)
        )
    );
  elsif p_table = 'paper_repository_links' then
    return exists (
      select 1 from app.papers paper
      where paper.id = (p_row->>'paper_id')::uuid and paper.owner_profile_id = profile
    );
  elsif p_table = 'repository_file_inspections'
    or p_table in ('runtime_model_instances','runtime_benchmark_records','cas_integrity_events') then
    return false;
  elsif p_table = 'repository_relationships' then
    return app.can_access_repository((p_row->>'source_repository_id')::uuid, true);
  elsif p_table = 'resource_group_members' then
    return exists (
      select 1 from app.resource_groups group_record
      where group_record.id = (p_row->>'resource_group_id')::uuid
        and app.can_access_organization(group_record.organization_id, true)
    );
  elsif p_table = 'resource_group_repositories' then
    return exists (
      select 1 from app.resource_groups group_record
      where group_record.id = (p_row->>'resource_group_id')::uuid
        and app.can_access_organization(group_record.organization_id, true)
    ) and app.can_access_repository((p_row->>'repository_id')::uuid, false);
  elsif p_table = 'robot_versions' then
    return exists (
      select 1 from app.robots robot
      where robot.id = (p_row->>'robot_id')::uuid
        and (
          robot.owner_profile_id = profile
          or app.can_access_organization(robot.owner_organization_id, true)
        )
    );
  elsif p_table = 'social_events' then
    return social_agent = nullif(p_row->>'actor_agent_id','')::uuid;
  elsif p_table = 'social_follows' then
    return social_agent = nullif(p_row->>'follower_agent_id','')::uuid;
  elsif p_table = 'social_votes' then
    return social_agent = nullif(p_row->>'voter_agent_id','')::uuid;
  elsif p_table = 'repository_downloads' then
    return p_operation = 'insert'
      and app.can_access_repository((p_row->>'repository_id')::uuid, false)
      and (
        nullif(p_row->>'downloader_profile_id','') is null
        or profile = (p_row->>'downloader_profile_id')::uuid
      );
  elsif p_table = 'transparency_reports' then
    return p_operation in ('insert','update') and app.current_context_service() = 'web';
  elsif p_table = 'waitlist' then
    return p_operation = 'insert' and app.current_context_service() = 'web';
  elsif p_table = 'audit_events' then
    return p_operation = 'insert' and profile is not null;
  elsif p_table in (
    'contact_submissions','request_limits','highlight_events',
    'robot_discovery_daily','transparency_discovery_daily','publication_keys',
    'publication_decisions'
  ) then
    return false;
  end if;

  foreach key in array array[
    'profile_id','owner_profile_id','author_profile_id','proposer_profile_id',
    'created_by_profile_id','actor_profile_id','follower_profile_id',
    'liker_profile_id','uploader_profile_id','operator_profile_id',
    'submitted_by_profile_id','reporter_profile_id','voter_profile_id',
    'destination_profile_id'
  ] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if profile is not null and candidate = profile then return true; end if;
  end loop;
  foreach key in array array[
    'organization_id','owner_organization_id','operator_organization_id',
    'sponsor_organization_id'
  ] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if candidate is not null and app.can_access_organization(candidate, true) then return true; end if;
  end loop;
  foreach key in array array['repository_id','source_repository_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if candidate is not null and app.can_access_repository(candidate, true) then return true; end if;
  end loop;
  foreach key in array array['agent_identity_id','claimed_by_agent_id','created_by_agent_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if agent is not null and candidate = agent then return true; end if;
  end loop;
  foreach key in array array['social_agent_id','voter_agent_id','follower_agent_id','actor_agent_id'] loop
    candidate := nullif(p_row->>key, '')::uuid;
    if social_agent is not null and candidate = social_agent then return true; end if;
  end loop;
  return false;
end
$write$;

do $access_helpers$
declare signature text;
begin
  foreach signature in array array[
    'app.can_access_organization(uuid,boolean)',
    'app.can_access_repository(uuid,boolean)',
    'app.tenant_can_read(text,jsonb)',
    'app.tenant_can_mutate(text,jsonb,text)'
  ] loop
    execute 'revoke all on function ' || signature || ' from public';
    execute 'grant execute on function ' || signature ||
      ' to superii_web_backend, superii_payment_backend, superii_publishing_backend';
  end loop;
end
$access_helpers$;

commit;

begin;

call app_private.install_least_privilege_policies();

-- The policy installer begins from a blanket function revocation. Restore only
-- invoker functions (which remain constrained by grants and RLS) plus the
-- reviewed SECURITY DEFINER gateways.
do $final_function_grants$
declare function_record record;
begin
  for function_record in
    select procedure.oid, pg_get_function_identity_arguments(procedure.oid) as arguments,
           procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app' and procedure.prokind = 'f'
      and not procedure.prosecdef
  loop
    execute format(
      'grant execute on function app.%I(%s) to superii_web_backend, superii_payment_backend, superii_runtime_backend',
      function_record.proname, function_record.arguments
    );
  end loop;
end
$final_function_grants$;

grant execute on function app.begin_request_context(
  text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,bigint,uuid,text
) to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.context_is_verified(), app.current_context_service(),
  app.current_actor_kind(), app.current_clerk_user_id(), app.current_profile_id(),
  app.current_agent_identity_id(), app.current_social_agent_id(),
  app.context_is_admin()
  to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.can_access_organization(uuid,boolean),
  app.can_access_repository(uuid,boolean), app.tenant_can_read(text,jsonb),
  app.tenant_can_mutate(text,jsonb,text)
  to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.consume_scoped_access_token(text,text,uuid),
  app.consume_agent_access_token(text,text,uuid),
  app.consume_social_credential(text,text),
  app.consume_social_pairing_code(text,text,text,text[],timestamptz),
  app.submit_contact(text,text,text,text,text,text),
  app.consume_request_limit(text,text,integer,integer),
  app.record_highlight_event(uuid,text,text),
  app.record_robot_discovery(text,text,text),
  app.record_transparency_discovery(text,text,text)
  to superii_web_backend;
grant execute on function app.consume_commerce_delegation(text,text)
  to superii_payment_backend;
grant execute on function app.consume_request_limit(text,text,integer,integer)
  to superii_payment_backend, superii_publishing_backend;
grant execute on function app.finalize_proposal_leaderboard(date)
  to superii_web_backend;
grant select on app.agent_reputation to superii_web_backend;

drop policy if exists publication_decisions_public_read on app.publication_decisions;
create policy publication_decisions_public_read on app.publication_decisions
  for select to superii_web_backend
  using (app.can_access_repository(repository_id, false));

revoke all on procedure app_private.install_least_privilege_policies()
  from public, superii_web_backend, superii_payment_backend,
       superii_publishing_backend, superii_runtime_backend;
comment on procedure app_private.install_least_privilege_policies() is
  'Migration-owner-only policy refresh; call after each later migration adds or changes app tables';

commit;
