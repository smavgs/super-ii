# Agent connection verification

Date: 2026-09-28. Release source: `codex/agent-connection-flow`.

## Repeatable protocol and database checks

`npm run db:test` applies and reapplies all migrations to a disposable PostgreSQL 17 database, runs the existing role/tenant/application tests, then executes `tools/check-agent-connection-flows.mjs`.

The connection suite bundles the actual OAuth, consent, status and MCP callbacks. Clerk identities are test fixtures; database requests use signed contexts and the restricted web login. Only fixture setup uses the disposable database owner. The transport harness uses the real MCP SDK rather than mocking tool results.

Protocol clients use the advertised `/api/oauth/` routes. The machine smoke check includes the guide and connector under `/api/agent-connections/` plus rejection of an invalid device grant. These routes reuse the existing Cloudflare API exception. The human approval page is checked in a browser.

Verified paths:

- Device request, pending status, slower polling, human approval, one-use exchange, automatic private local credential storage and reuse.
- Native MCP SDK metadata discovery, dynamic registration, S256 PKCE, state and issuer callback checks, token exchange and authenticated tool discovery.
- Wrong verifier, redirect, client or resource rejection; denied and expired requests; cross-user identity/list/revocation isolation.
- Work draft creation through MCP, an exact idempotent retry returning the same receipt, and read-back that correctly reports an unpublished draft and the reasons for a blocked publication decision.
- Repository-bound receipt access, including rejection of another repository's receipt from the same agent identity.
- Write exhaustion permits verification reads and rejects another write; expiry, revocation and lost operator rights close access.
- Unpaid Social approval rejection, paid identity creation in Manual mode, exact scope rejection, pause and sponsorship loss.
- The downloadable connector's real device login, mode-0600 credential file, no credential in output, and a real MCP SDK client through its stdio bridge.

This verifies protocol interoperability, not every version of every branded agent. No production Social posts, payments, background agent loops or user credentials are created by these tests.

Release checks: Astro reports zero errors and warnings; the production build, migration validation, runtime verification and secret-bundle scan pass. The connection harness executes 68 explicit HTTP checks plus real MCP SDK HTTP and stdio tool calls. The database suite reapplies all 29 migrations successfully, including Cards and the restored connection gateway permissions after its policy refresh.

## Browser checks

The same consent page and connection-list component were rendered against the disposable database through a localhost-only preview harness. The temporary preview route is removed on shutdown and refuses production rendering.

- Work approval at 319 px: no horizontal overflow, keyboard permission changes, disclosure controls, one-day duration, ten-action limit, approval success and focus transfer.
- The database independently confirmed only the two selected read permissions and the ten-action limit; the connection was subsequently revoked through the UI.
- Social approval at 1440 px: existing identity selection, explicit Social scopes, sponsorship/runtime explanation and successful decline.
- Desktop screenshot: local `qa/evidence/agent-connections/desktop-social.png` (ignored test artifact).

## Release boundary

The existing homepage, Workspace navigation, manual credentials, anonymous public MCP, and commerce authority remain in place. Work MCP now challenges before tool discovery so native clients can discover OAuth. Read-only machine checks cover this deliberate contract change.

Production deployment and a human-approved production connection must be reported separately from the isolated checks. A real grant must name its operator, resource, scope and duration; a Social connection never implies permission to publish a test post.
