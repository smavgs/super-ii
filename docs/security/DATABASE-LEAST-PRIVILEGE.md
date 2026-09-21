# Database least privilege and production cutover

Super ii uses independent PostgreSQL identities for normal website requests,
payments, trusted publishing, and the local runtime. The Neon schema owner is a
migration and incident-recovery identity only. It must never be stored in a
Cloudflare Worker secret or used by a continuously running service.

Migration `0023_runtime_least_privilege.sql` activates the database boundary.
It creates four `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`,
`NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS` privilege bundles:

| Bundle | Purpose | Explicit boundary |
| --- | --- | --- |
| `superii_web_backend` | Website, public APIs, Clerk members, agents and Social | Tenant-aware reads/writes only |
| `superii_payment_backend` | Checkout, commerce and verified NOWPayments callbacks | Billing records; no agent credentials or publishing administration |
| `superii_publishing_backend` | GitHub OIDC trusted-publishing exchange | Publisher verification and scoped-token issuance only |
| `superii_runtime_backend` | Local transfer, inspection, build and execution workers | Repository pipeline records; no billing or private web identity tables |

The stable LOGIN roles inherit exactly one bundle. The independent publication
policy signer keeps its existing `superii_policy` bundle.

## Verified request context

Neon's HTTP driver may reuse pooled database sessions, so Super ii does not use
session-global tenant variables. Every website, payment, and trusted-publishing
request is converted into a single database transaction containing:

1. `app.begin_request_context(...)` with a 30-second identity envelope and
   HMAC signature; and
2. the original query or query batch.

The HMAC is verified inside a reviewed `SECURITY DEFINER` function. Verified
identity state is kept in the owner-only `app_private` schema and keyed by both
backend PID and transaction ID. It therefore cannot survive into a later pooled
request. Application roles cannot read the context keys or private state.

Row-level policies cover every table in the `app` schema. They derive the
current profile, organization, agent, Social identity, or trusted service only
from the verified transaction context. Token exchanges are narrow
`SECURITY DEFINER` gateways; after a hash-at-rest token is consumed, the Worker
updates the signed context before it performs tenant work.

This limits a leaked database password and ordinary SQL injection to the
credential's compartment. A fully compromised Worker can still use every
secret available to that Worker, so route authentication, input validation,
secret rotation, logging, and Cloudflare controls remain required.

## Secret locations

The migration owner URL is stored only in macOS Keychain as
`superii-migration-database-url` (account `superii.site`) or supplied locally as
`MIGRATION_DATABASE_URL`. It is intentionally not a Worker environment name.

The provisioner stores restricted URLs and context material in Keychain:

- `superii-web-database-url`
- `superii-payment-database-url`
- `superii-publishing-database-url`
- `superii-runtime-database-url`
- the matching `*-database-context-key-id` and
  `*-database-context-secret` items for web, payment, and publishing

Cloudflare receives only these application secrets:

- `DATABASE_URL`, `DATABASE_CONTEXT_KEY_ID`, `DATABASE_CONTEXT_SECRET`
- `DATABASE_PAYMENT_URL`, `DATABASE_PAYMENT_CONTEXT_KEY_ID`,
  `DATABASE_PAYMENT_CONTEXT_SECRET`
- `DATABASE_PUBLISHING_URL`, `DATABASE_PUBLISHING_CONTEXT_KEY_ID`,
  `DATABASE_PUBLISHING_CONTEXT_SECRET`

## Provision and verify

Run schema changes with the runtime Python environment and migration-only URL:

```sh
runtime/.venv/bin/python tools/apply_migrations.py
runtime/.venv/bin/python tools/provision_database_roles.py
runtime/.venv/bin/python tools/audit_database_roles.py
```

For a temporary Neon branch, use a separate Keychain namespace so no rehearsal
can replace production credentials:

```sh
runtime/.venv/bin/python tools/apply_migrations.py \
  --keychain-service superii-lp-test-migration-database-url
runtime/.venv/bin/python tools/provision_database_roles.py --namespace superii-lp-test
runtime/.venv/bin/python tools/audit_database_roles.py --namespace superii-lp-test
./scripts/preview-with-keychain-database.sh superii-lp-test 8798
```

The preview launcher writes the nine branch-only bindings to a mode-600
temporary file, never prints them, and removes the file when Wrangler exits.

On the first cutover only, when the pre-cutover owner is still stored in the old
runtime Keychain item, use
`tools/provision_database_roles.py --bootstrap-owner-from-runtime`. The command
copies it into the migration-only item before replacing the runtime item with a
restricted URL. It never prints a password, URL, or context secret.

Before production, create a Neon branch from the production branch, apply all
migrations, provision branch-only credentials, then run:

```sh
npm run check
npm run validate
npm run db:check
npm run db:test
npm run build
```

The database integration test verifies rerunnable migrations, forged-context
rejection, cross-tenant private-repository denial, and all four role boundaries.
Delete branch-only credentials and the temporary Neon branch after the evidence
is retained.

Every later migration that adds or changes an `app` table must extend the
reviewed role arrays when needed and finish with
`call app_private.install_least_privilege_policies();`. The procedure remains
owner-only. CI checks that every application table has RLS enabled, so an
unprotected future table fails the release rather than silently widening access.

## Gradual Cloudflare cutover

1. Record the current 100% production version as the rollback anchor.
2. Apply migration `0023` with the migration identity and provision the four
   production logins.
3. Switch the local runtime Keychain URL, restart the services, and verify
   readiness and a real repository operation.
4. Upload a new Worker version containing only restricted database URLs and
   context keys.
5. Smoke-test that version directly, then move traffic through 1%, 10%, 50%,
   and 100% while monitoring Worker errors, `/api/health`, public catalog reads,
   signed-in profile access, publishing, and payment callbacks.
6. If any gate fails, immediately return 100% traffic to the recorded version.
   Database migration `0023` is additive, so the prior Worker remains usable
   during the bounded rollback window.
7. After the restricted version is stable, rotate the Neon owner password.
   Replace only `superii-migration-database-url`; this makes every historical
   Worker version that held the old owner URL inert.

Never broaden a role during an incident. Roll back the Worker, diagnose on a
temporary Neon branch, add the smallest reviewed grant or gateway, and repeat
the staged verification.
