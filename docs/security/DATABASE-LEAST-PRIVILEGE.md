# Database least-privilege migration

Super ii authorizes every request in the server application today. PostgreSQL
constraints, transactions, immutable-record triggers, and row-level-security
policies add defense in depth, but a schema-owner connection can bypass ordinary
row-level security. The checked-in application therefore must not be represented
as having an independent database tenant barrier until the connection role is
changed and the full policy suite passes under that role.

Migration `0022_backend_role_foundation.sql` creates the target
`superii_web_backend` privilege bundle as `NOLOGIN`, `NOSUPERUSER`,
`NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. It has no
schema, table, sequence, or function privileges. The migration also removes
implicit `PUBLIC` access to the `app` schema and its objects. It does not create
a password, change `DATABASE_URL`, or activate a production identity.

## Required cutover sequence

1. Inventory every database call by public read, member read, member write,
   organization administration, runtime, payment callback, and publication
   policy purpose.
2. Replace owner-dependent behavior with narrowly granted tables or dedicated
   `SECURITY DEFINER` functions whose owners, arguments, `search_path`, and
   execute grants are independently reviewed.
3. Carry the Clerk-verified profile and organization context into a transaction
   using a database-local value that the caller cannot forge or persist across
   pooled requests.
4. Add and test row policies for every private table; force RLS where the table
   owner must not bypass it. Public catalog reads receive separate read-only
   grants.
5. Run the entire PostgreSQL and application test suite while connected as the
   candidate login role. Prove cross-user, cross-organization, expired-token,
   revoked-token, origin, and unauthenticated failures.
6. Create the actual login credential outside Git, grant only the reviewed
   bundle, rotate the Worker secret, deploy, and verify production. Keep the old
   owner credential only as a separately controlled migration/incident identity.
7. Revoke the application path from the owner credential after a bounded
   rollback window.

## Release gate

Do not switch the production connection merely because the inert role exists.
Cutover requires route-by-route evidence and a rollback plan. A partial grant
set should fail closed rather than be widened ad hoc during an incident.
