# Super ii

The production website for [superii.site](https://superii.site): a fast, public AI collaboration hub for models, datasets, apps, and organizations.

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

Infrastructure is split deliberately:

- **Super ii Website** is the Cloudflare/Astro control plane and public UI.
- **Super ii Runtime** is the self-hosted Linux data plane for files, scanning, offline inspection, llama.cpp, Diffusers, and isolated Gradio Spaces.
- **Postgres** stores immutable repository history, search, review evidence, community data, collections, and lineage.

The website talks only to the Super ii Runtime; it does not use OpenAI, Anthropic, Hugging Face Inference, or another commercial model-routing API. Cloudflare, Clerk, and Neon free tiers allow a zero-upfront website launch. The runtime uses hardware the operator already controls; paid compute and metered services are not represented as free.

The requested repository core, safe/offline inspectors, structured dataset and model previews, tokenizer, Transformers.js, llama.cpp, Diffusers, isolated Gradio iframe path, Postgres search, upload gates, community, social graph, collections, and lineage are implemented. vLLM and Text Embeddings Inference remain deliberately deferred until dedicated GPU capacity and measured Postgres search limits respectively. “Implemented” describes the verified code path; publishing and server inference still fail closed whenever the separate runtime host is not operational.

## Agent-native surface

- [`SYSTEM-STATE.md`](SYSTEM-STATE.md) is the canonical capability register and uses an evidence-based status ladder from `designed` through `GA`.
- `/mcp` is a stateless Streamable HTTP MCP server with 16 bounded, read-only public tools for search, repositories, files, lineage, compatibility, papers, documentation, security state, traces, and verified download resolution.
- Every reviewed public repository has one source of truth and stable HTML, Markdown, JSON, README, `agents.md`, manifest, API-contract, and MCP representations.
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

`npm run validate` runs three independent checks:

- Python validates the product contract, honest empty catalogs, plan states, routes, forbidden legacy claims, and exact SHA-256 of the user-supplied logo.
- Go independently verifies the route/plan/catalog contract and exact logo hash.
- JavaScript checks every declared route and internal link against the Astro source tree.

`npm run db:check` verifies transactions, PL/pgSQL, row-level security, the repository core, Postgres search, community/social/collection/lineage tables, fail-closed publication gates, and no repository seed rows.

`npm run db:test` applies every migration twice to a disposable PostgreSQL 17 container, runs the transactional interaction and publication smoke test, and verifies that test rows roll back cleanly.

## Database

Apply every file in `database/migrations/` in lexical order to a new, isolated Postgres database. The 45-table schema creates the launch records, immutable repository revisions/files, security evidence, discovery, community, social graph, collections, lineage, compatibility, resource groups, service accounts, trusted publishers, scoped tokens, and agent traces. It does not create model, dataset, app, user, or organization records.

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
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
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
