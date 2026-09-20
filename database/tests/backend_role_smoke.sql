\set ON_ERROR_STOP on

do $test$
declare
  role_state record;
  object_record record;
begin
  select rolinherit, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    into role_state
    from pg_roles
    where rolname = 'superii_web_backend';

  if not found then
    raise exception 'backend role missing';
  end if;
  if role_state.rolinherit or role_state.rolcanlogin or role_state.rolsuper or role_state.rolcreatedb
    or role_state.rolcreaterole or role_state.rolreplication or role_state.rolbypassrls then
    raise exception 'backend role has a forbidden cluster capability';
  end if;
  if exists (
    select 1
      from pg_auth_members membership
      join pg_roles member on member.oid = membership.member
      where member.rolname = 'superii_web_backend'
  ) then
    raise exception 'backend role unexpectedly inherits another role';
  end if;
  if has_schema_privilege('superii_web_backend', 'app', 'USAGE') then
    raise exception 'backend role became active before route grants were reviewed';
  end if;

  for object_record in
    select class.oid, class.relkind
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'app' and class.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    if object_record.relkind = 'S' then
      if has_sequence_privilege('superii_web_backend', object_record.oid, 'USAGE') then
        raise exception 'backend role has unexpected sequence privilege';
      end if;
    elsif has_table_privilege(
      'superii_web_backend', object_record.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'backend role has unexpected relation privilege';
    end if;
  end loop;

  for object_record in
    select procedure.oid
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
  loop
    if has_function_privilege('superii_web_backend', object_record.oid, 'EXECUTE') then
      raise exception 'backend role has unexpected function privilege';
    end if;
  end loop;
end
$test$;
