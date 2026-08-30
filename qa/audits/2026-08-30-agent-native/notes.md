# Super ii agent-native production audit

Snapshot: 2026-08-30

Production origin: https://superii.site

Cloudflare Worker version: `cc095d9d-a968-4374-a01c-0d8471108972`

## Step health

| Step | Health | Evidence |
| --- | --- | --- |
| 1. Brand and public shell | Green | Supplied single-line yellow `Sii` logo is unchanged; desktop home is responsive, readable, and free of browser-console errors. |
| 2. Discovery and hardware filtering | Green | Models renders real database state, remains honestly empty, and exposes task, library, license, modality, author, GiB size, date, hardware, OS, RAM, VRAM, and sort controls. Hardware selects were visually normalized during this audit. |
| 3. Agent-native resources | Green | `/agents.md`, `/system-state.md`, `/system-state.json`, repository representation routes, paper representations, and `/mcp` are deployed. MCP initializes over Streamable HTTP, lists 16 read-only tools, returns the real empty catalog, and rejects a disallowed origin. |
| 4. Repository and permission data | Green | Seven rerunnable migrations produce 45 application tables. PostgreSQL 17 transactional tests cover immutable publication, compatibility sync, resource-group permissions, service accounts, scoped tokens, and rollback cleanliness. |
| 5. Self-hosted runtime | Green | Local and public-tunnel health, readiness, capabilities, database, storage, ClamAV, Gitleaks, llama.cpp, Diffusers, and Gradio paths are ready. The deployed runtime copy passes 31 tests and Ruff. |
| 6. Authentication and checkout | Green with a deliberate boundary | The signed-in production workspace renders repository, organization, billing, and payment-history sections without a signed-out prompt. Exactly one Pro order is waiting for `9.00 USD` in `USDC` on Ethereum; it is unpaid, has no `paid_at` value, and no funds were moved. |
| 7. Status truth | Green | The public system-state page separates production, integrated, tested, implemented, and designed work. Deferred hostile-compute and GPU-cloud work is not presented as live. |

## Verification gates

- `npm run check`: 120 files, zero errors, warnings, or hints.
- `npm run validate`: Python, Go, JavaScript routes, content, brand, and agent-machine contracts pass.
- `npm run db:check`: seven migrations and 45-table contract pass.
- `npm run db:test`: migrations apply twice to PostgreSQL 17 and the transactional integration suite passes.
- Runtime: 31 tests pass; Ruff passes.
- `npm run build`: release-secret scan covers 187 output files and finds no private local values.
- Production HTTP: key public routes return 200 with HSTS, CSP, nosniff, frame, referrer, and permissions policies.
- Production MCP: initialization, `tools/list`, hardware-filtered `search_models`, read-only annotations, and origin rejection pass.

## Evidence limits

- The catalog intentionally has no approved models, datasets, or apps. Repository representations and visual lineage are deployed, but a public content-driven example cannot be verified until a real reviewed revision exists.
- Hardware analysis is connected across the runtime, database, search, MCP, and UI, but no sample model is seeded merely to manufacture evidence.
- GitHub OIDC trusted publishing rejects unauthorized exchanges in production. A successful signed exchange requires the first owner-configured repository and workflow binding.
- This is a production implementation and interaction audit, not a formal WCAG conformance certification or independent penetration test.

## Screenshots

- `01-home.png`, `02-models.png`, `03-docs.png`: pre-change production reference captures.
- `04-home-live.png`: deployed home at the original desktop audit width.
- `06-models-final.png`: final hardware and GiB discovery controls after visual correction.
- `07-docs-final.png`: final agent-native, compatibility, and trusted-publishing documentation.
- `08-system-state-final.png`: final public capability and evidence register.
