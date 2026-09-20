-- Establishes a zero-authority role for the future least-privilege web cutover.
-- The production connection is not switched until every route has an explicit,
-- tested grant and row policy. Applying this migration cannot grant application
-- access by itself.

begin;

do $role$
declare
  inherited_role text;
begin
  if not exists (select 1 from pg_roles where rolname = 'superii_web_backend') then
    create role superii_web_backend nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;

  for inherited_role in
    select granted.rolname
      from pg_auth_members membership
      join pg_roles member on member.oid = membership.member
      join pg_roles granted on granted.oid = membership.roleid
      where member.rolname = 'superii_web_backend'
  loop
    execute format('revoke %I from superii_web_backend', inherited_role);
  end loop;
end
$role$;

alter role superii_web_backend with nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls;

-- Custom schemas do not normally expose these privileges to PUBLIC, but state
-- the boundary explicitly and remove PostgreSQL's default function execution
-- grant. Object owners and explicitly granted service roles remain unaffected.
revoke all on schema app from public;
revoke all on all tables in schema app from public;
revoke all on all sequences in schema app from public;
revoke execute on all functions in schema app from public;

alter default privileges in schema app revoke all on tables from public;
alter default privileges in schema app revoke all on sequences from public;
alter default privileges in schema app revoke execute on functions from public;

-- Keep the future backend role inert until the documented route-by-route
-- cutover is complete. A login credential must never be added to this role.
revoke all on schema app from superii_web_backend;
revoke all on all tables in schema app from superii_web_backend;
revoke all on all sequences in schema app from superii_web_backend;
revoke execute on all functions in schema app from superii_web_backend;

comment on role superii_web_backend is
  'NOLOGIN, NOBYPASSRLS privilege bundle reserved for a tested Super ii web cutover';

commit;
