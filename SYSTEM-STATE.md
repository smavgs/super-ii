# Super ii system state

Canonical product and operations truth for the Super ii control plane and self-hosted runtime.

- Snapshot: 2026-08-30
- Canonical origin: https://superii.site
- Policy: a capability never advances because code exists alone; each status requires evidence from its own layer.
- Empty-catalog rule: no model, dataset, or app is seeded or presented as community content.

## Status ladder

1. `designed` — contract and safety boundaries are documented.
2. `implemented` — code and schema exist.
3. `tested` — repeatable local checks pass.
4. `integrated` — dependent services work together through the real request path.
5. `staging` — deployed to a production-like environment.
6. `production` — deployed on the public production path and independently verified.
7. `GA` — generally available with documented support and operational maturity.

## Capability register

| Capability | Status | Availability | Evidence |
| --- | --- | --- | --- |
| Astro and Cloudflare public control plane | production | live | Server-rendered routes, security headers, health checks, and the canonical domains are deployed. |
| Email, Google, and GitHub authentication | production | live | Clerk-backed sign-in and sign-up use the production application and same-origin server routes. |
| Immutable repository engine | production | live | Postgres stores repositories, folders by path, revisions, commits, branches, tags, releases, manifests, SHA-256 checksums, and download records. |
| Creator upload and review pipeline | production | fail-closed | Upload, quarantine, ClamAV, Gitleaks, format policy, offline analysis, immutable manifest, and human review are required; uploads close when runtime gates are unavailable. |
| Model and dataset analysis pages | production | live when content exists | Public pages render cards, files, versions, licenses, tensor and tokenizer information, bounded dataset previews, statistics, provenance, and discussions from reviewed data only. |
| Protected Gradio Apps runtime | production | authenticated | Rootless isolated containers, runtime status, logs, controls, iframe proxying, and streaming paths require the self-hosted runtime. |
| Community and discovery | production | live | Search, filters, trending, downloads, likes, follows, watches, discussions, comments, notifications, related repositories, collections, papers, posts, and feeds use real Postgres state. |
| USDC on Ethereum checkout | production | live | NOWPayments creates bounded Pro and Team orders; entitlements require a signed, exact, terminal payment callback. No card collection is enabled. |
| Repository HTML, Markdown, and JSON representations | production | live when reviewed content exists | Public negotiation and stable README, agents.md, manifest, API, and MCP routes are deployed; the intentionally empty catalog has no repository sample yet. |
| Public read-only Super ii MCP | production | live | Production initialization, tool discovery, hardware-filtered search, empty-catalog truth, security headers, origin rejection, and all 16 read-only tool annotations are verified. |
| Hardware compatibility intelligence | integrated | waiting for the first reviewed model analysis | The 45-table production schema, live MCP filters, and deployed offline runtime are connected; no content is seeded solely to manufacture a successful analysis example. |
| Resource groups and granular repository permissions | tested | foundation | Postgres roles and fail-closed permission checks pass transactional integration tests; full organization administration UI is intentionally later. |
| Service accounts and scoped access tokens | tested | foundation | Opaque, hash-at-rest, repository-bound, scope-bound, revocable, expiring token behavior passes transactional integration tests. |
| GitHub Actions trusted publishing | tested | configuration required | The public exchange rejects unauthorized callers and the code verifies issuer, audience, subject, workflow, repository, lifetime, signature, and scopes; a successful live exchange awaits the first configured repository and workflow. |
| Agent traces | implemented | opt-in | Trace metadata is private by default and exposes only hashes and explicitly public records. |
| Hostile multi-tenant compute isolation | designed | deferred | Current Apps use bounded rootless containers; stronger microVM-grade isolation is required before untrusted multi-tenant compute is advertised. |
| Hosted GPU cloud and high-throughput serving | designed | deferred | Super ii does not claim a free GPU cloud. vLLM, dedicated GPU pools, and mountable high-volume storage wait for measured demand and funded capacity. |

## Release truth rules

- `implemented` never means deployed.
- `production` never means generally available.
- A disconnected scanner, database, object store, or runtime closes the affected path instead of bypassing it.
- Derived compatibility is guidance, not a benchmark or guarantee.
- Missing provenance evidence remains missing; it is not converted into a positive claim.
- Public MCP is read-only. Compute, publishing, and private data require scoped authentication on separate routes.
- Secrets, raw access tokens, model prompts, private files, and payment credentials never belong in agent traces or public metadata.

## Deliberate sequence

1. Repository truth and content-addressed storage.
2. Machine-readable repository surfaces and public read-only MCP.
3. Hardware discovery, lineage, trusted publishing, and scoped automation.
4. Creator and community growth.
5. Commercial infrastructure only when usage and safety evidence justify it.
