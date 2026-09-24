-- Model analysis writes repository_revision_analyses through the runtime role.
-- Its revision-scoped trigger maintains repository_compatibility in the same
-- transaction, so that derived table must sit inside the same runtime boundary.

begin;

drop policy if exists superii_runtime_service_all on app.repository_compatibility;
create policy superii_runtime_service_all on app.repository_compatibility
  for all to superii_runtime_backend
  using (true)
  with check (true);

grant select, insert, update, delete on app.repository_compatibility
  to superii_runtime_backend;

comment on policy superii_runtime_service_all on app.repository_compatibility is
  'Runtime-owned derived compatibility projection maintained from revision analysis';

commit;
