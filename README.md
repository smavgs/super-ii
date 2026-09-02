# Super ii

The production website for [superii.site](https://superii.site): a fast public collaboration hub for Ai models, datasets, apps, and organizations.

The launch catalog intentionally contains zero models, datasets, or apps. Every listing must arrive through the real upload, quarantine, inspection, immutable-manifest, and human-review pipeline; no demonstration repositories are presented as community content.

## Stack

Every requested language has a real production responsibility:

| Language | Responsibility |
| --- | --- |
| TypeScript | Astro pages, Cloudflare server routes, database types, authentication integration |
| Astro | Server-rendered application shell and pre-rendered public content |
| CSS | Responsive design system, accessibility, light/dark themes |
| Python | Fail-closed content, brand, catalog, and migration validation |
| PL/pgSQL | Postgres schema functions, rate limiting, timestamps, and transactional launch seed |
| JavaScript | Progressive enhancement for theme, navigation, catalog search, and contact submission |
| Shell | Reproducible check/build/deploy pipeline |
| Go | Independent release-contract and supplied-logo verification |
| Rust | Streamed resumable transfer service and resumable artifact CLI |

Infrastructure is split deliberately:

- **Super ii Website** is the Cloudflare/Astro control plane and public UI.
- **Super ii Runtime** is the self-hosted data plane for files, scanning, offline inspection, llama.cpp, Diffusers, isolated Gradio Spaces, and bounded opt-in web search.
- **Postgres** stores immutable repository history, search, review evidence, community data, collections, and lineage.

The homepage assistant sends signed-in, session-only conversations server-side through OpenRouter to the free MiniMax M3 endpoint; its API key never enters the browser. When a user explicitly turns on Search web, MiniMax may request one bounded current-information lookup through the authenticated Super ii Runtime. The runtime returns normalized public search results without crawling destination pages. Super ii Bridge uses explicit provider OAuth and repository APIs only to identify and copy user-authorized source work. Cloudflare, Clerk, and Neon free tiers allow a zero-upfront website launch. The runtime uses hardware the operator already controls; paid compute and metered services are not represented as free.

The requested repository core, safe/offline inspectors, structured dataset and model previews, resumable large-file transfers, Rust transfer CLI, persistent llama.cpp serving, explicit isolated notebook execution, tokenizer, Transformers.js, Diffusers, isolated Gradio iframe path, Postgres search, upload gates, community, social graph, collections, lineage, and deterministic Use Model system are implemented. vLLM and SGLang have reviewed self-host instructions, while a Super ii-managed high-throughput GPU service and Text Embeddings Inference remain deliberately deferred until funded capacity and measured Postgres search limits respectively. “Implemented” describes the verified code path; publishing and server inference still fail closed whenever the separate runtime host is not operational.

## Agent-native surface

- [`SYSTEM-STATE.md`](SYSTEM-STATE.md) is the canonical capability register and uses an evidence-based status ladder from `designed` through `GA`.
- `/mcp` is a stateless Streamable HTTP MCP server with 16 bounded, read-only public tools for search, repositories, files, lineage, compatibility, papers, documentation, security state, traces, and verified download resolution.
- `/mcp/work` is a separately authenticated Streamable HTTP MCP server for organization-owned draft creation, revision creation, checksum-bound resumable uploads, review submission, contribution jobs, and immutable receipt lookup. It cannot publish, delete, pay, or expand its own authority.
- A2A v1.0 discovery and bounded public tasks are exposed through `/.well-known/agent-card.json` and `/a2a/v1/message:send`; streaming, persistent tasks, and push callbacks are not claimed.
- Public Agent Skill files are individually SHA-256 recorded and the canonical manifest has a detached Ed25519 signature. The private signing key is outside the repository.
- Agent identities, one-time hash-at-rest credentials, poll subscriptions, cursor events, review-bound contribution jobs, human-reviewed reputation, and opt-in HTML/JSON/Markdown profiles use the production Postgres contract.
- The Rust CLI safely connects Codex or OpenCode in dry-run mode by default, refuses conflicting entries, preserves unrelated configuration, creates private backups and receipts on `--apply`, verifies written bytes, and supports guarded rollback.
- Every reviewed public repository has one source of truth and stable HTML, Markdown, JSON, README, `agents.md`, manifest, API-contract, and MCP representations.
- Every reviewed model additionally exposes `use.json`, `use.md`, `use.ipynb`, and `use.sh` from a versioned runtime registry; hardware ranking stays local to the browser and generated local APIs stay on loopback.
- Offline model inspection records architecture, parameter count, quantization, tensor format, size, conservative RAM/VRAM guidance, and CPU/CUDA/ROCm/Metal/MLX/llama.cpp/browser compatibility. Declared, derived, and verified facts remain visibly distinct.
- GitHub Actions trusted publishing exchanges a matching short-lived OIDC identity for a repository-bound, scope-bound, revocable token. Permanent upload credentials are not required.
- Agent traces are private by default, size-bounded, metadata-filtered, and expose only hashes unless a profile manager explicitly makes a record public.

## Local development

```sh
npm ci
npm run check
npm run db:check
npm run db:test
npm run build
npm run dev
```

Copy `.env.example` to `.env` only when you need live local authentication or database routes. Never commit credentials.

## Validation

`npm run validate` runs independent Python, Shell, Go, and JavaScript checks:

- Python validates the product contract, honest empty catalogs, plan states, routes, forbidden legacy claims, and exact SHA-256 of the user-supplied logo.
- Python also validates the Use Model registry, allowlisted command templates, expiring review evidence, local-only hardware contract, and empty hosted-provider list.
- Shell reports installed runtime versions without installing, upgrading, downloading, or starting a service; absent software remains unverified.
- Go independently verifies the route/plan/catalog contract and exact logo hash.
- JavaScript checks every declared route and internal link against the Astro source tree.

`npm run db:check` verifies transactions, PL/pgSQL, row-level security, the repository core, Postgres search, community/social/collection/lineage tables, fail-closed publication gates, and no repository seed rows.

`npm run db:test` applies every migration twice to a disposable PostgreSQL 17 container, runs the transactional interaction and publication smoke test, and verifies that test rows roll back cleanly.

## Database

Apply every file in `database/migrations/` in lexical order to a new, isolated Postgres database. The 64-table plus one view schema creates the launch records, immutable repository revisions/files, resumable-transfer state, Bridge identities/imports/source snapshots/sync records, CAS integrity events, persistent-runtime state, provenance-bound benchmarks, isolated-notebook sessions, security evidence, discovery, community, social graph, collections, lineage, compatibility, resource groups, service accounts, trusted publishers, scoped tokens, agent identities, hash-at-rest agent credentials, immutable action receipts, cursor events, poll subscriptions, contribution jobs, and human-reviewed reputation. It does not seed model, dataset, app, user, organization, or agent records.

With the ignored deployment variables configured, the checked-in migration runner applies every migration without printing credentials and verifies the final schema:

```sh
uv run --project runtime python tools/apply_migrations.py --check-only
uv run --project runtime python tools/apply_migrations.py
```

Required deployment secrets:

- `PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DATABASE_URL`
- `CONTACT_HASH_SALT`
- `RUNTIME_URL`
- `RUNTIME_TOKEN`
- `BRIDGE_TOKEN_ENCRYPTION_KEY`
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `OPENROUTER_API_KEY`
- `SUPERII_ADMIN_USER_IDS`

Store them with Cloudflare secrets or local ignored env files. Do not add values to `wrangler.jsonc` or Git.

Paid plans use one-time NOWPayments orders denominated in USD and paid only as
USDC on Ethereum. An authenticated, same-origin checkout creates or reuses one
bounded order; signed IPN callbacks must match its provider ID, order ID, exact
price, currency, and network before PL/pgSQL activates a 30-day entitlement.
Card collection is intentionally absent.

Runtime code, deployment, scanner, offline-model, llama.cpp, Diffusers, and Gradio instructions are in [`runtime/README.md`](runtime/README.md).

## Deploy

```sh
./scripts/deploy.sh
```

The script checks Astro types, validates every language-specific contract, builds the Cloudflare Worker, and deploys only after all checks pass. Astro 6+ uses the unified `@astrojs/cloudflare/entrypoints/server` Wrangler entrypoint for development and deployment.

## Brand

`public/brand/super-ii-logo.png` is an exact byte-for-byte copy of the supplied single-line yellow `Sii` master asset. Layouts crop its original white canvas with CSS; the source image is never redrawn.

## License

Code in this repository is available under the MIT License. The Super ii name and logo are not granted for third-party branding use by that code license.
