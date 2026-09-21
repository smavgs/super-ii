\set ON_ERROR_STOP on

do $test$
declare
  role_name text;
  role_state record;
  missing_policies integer;
begin
  foreach role_name in array array[
    'superii_web_backend','superii_payment_backend',
    'superii_publishing_backend','superii_runtime_backend'
  ] loop
    select rolinherit, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls
      into role_state from pg_roles where rolname = role_name;
    if not found then raise exception '% role missing', role_name; end if;
    if role_state.rolinherit or role_state.rolcanlogin or role_state.rolsuper
      or role_state.rolcreatedb or role_state.rolcreaterole
      or role_state.rolreplication or role_state.rolbypassrls then
      raise exception '% has a forbidden cluster capability', role_name;
    end if;
    if not has_schema_privilege(role_name, 'app', 'USAGE') then
      raise exception '% cannot use the application schema', role_name;
    end if;
    if has_schema_privilege(role_name, 'app_private', 'USAGE') then
      raise exception '% can enter the private security schema', role_name;
    end if;
  end loop;

  if not has_function_privilege(
    'superii_web_backend',
    'app.begin_request_context(text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,bigint,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'web role cannot establish a signed request context';
  end if;
  if has_function_privilege(
    'superii_web_backend',
    'app.apply_publication_decision(text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'web role can apply an automatic publication decision';
  end if;
  if has_table_privilege('superii_web_backend', 'app.payment_orders', 'INSERT,UPDATE,DELETE') then
    raise exception 'web role can mutate payment orders';
  end if;
  if has_table_privilege('superii_payment_backend', 'app.agent_access_tokens', 'SELECT') then
    raise exception 'payment role can read agent credentials';
  end if;
  if has_table_privilege('superii_publishing_backend', 'app.payment_orders', 'SELECT') then
    raise exception 'publishing role can read payment orders';
  end if;
  if has_table_privilege('superii_runtime_backend', 'app.payment_orders', 'SELECT') then
    raise exception 'runtime role can read payment orders';
  end if;
  if not has_function_privilege(
    'superii_payment_backend',
    'app.consume_request_limit(text,text,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'superii_publishing_backend',
    'app.consume_request_limit(text,text,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'sensitive service boundary cannot use the shared rate limiter';
  end if;
  if not has_function_privilege(
    'superii_web_backend', 'app.finalize_proposal_leaderboard(date)', 'EXECUTE'
  ) or not has_table_privilege(
    'superii_web_backend', 'app.agent_reputation', 'SELECT'
  ) then
    raise exception 'public aggregate contracts are unavailable to the web role';
  end if;

  select count(*) into missing_policies
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'app' and class.relkind in ('r','p')
    and not class.relrowsecurity;
  if missing_policies <> 0 then
    raise exception '% application tables do not enforce RLS', missing_policies;
  end if;
  if exists (
    select 1 from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'app' and class.relkind in ('r','p')
      and not exists (
        select 1 from pg_policy policy
        join pg_roles role on role.oid = any(policy.polroles)
        where policy.polrelid = class.oid and role.rolname = 'superii_web_backend'
      )
  ) then
    raise exception 'one or more application tables lack a web-role policy';
  end if;
end
$test$;
