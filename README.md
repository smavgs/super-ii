# Super ii

The production website for [superii.site](https://superii.site): a fast, public AI collaboration hub for models, datasets, apps, and organizations.

The launch catalog intentionally contains zero models, datasets, or apps. Publishing and downloads open only after real storage, review, moderation, and access controls are ready.

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

Infrastructure is Cloudflare Workers, Clerk authentication, and Neon Postgres. The free tiers allow a zero-upfront launch; payment and metered infrastructure still incur disclosed fees when customers use paid services.

## Local development

```sh
npm ci
npm run check
npm run db:check
npm run build
npm run dev
```

Copy `.env.example` to `.env` only when you need live local authentication or database routes. Never commit credentials.

## Validation

`npm run validate` runs three independent checks:

- Python validates the product contract, honest empty catalogs, plan states, routes, forbidden legacy claims, and exact SHA-256 of the user-supplied logo.
- Go independently verifies the route/plan/catalog contract and exact logo hash.
- JavaScript checks every declared route and internal link against the Astro source tree.

`npm run db:check` verifies the SQL migration uses transactions, PL/pgSQL, row-level security, all required tables, and no repository seed rows.

## Database

Apply `database/migrations/0001_launch_schema.sql` to a new, isolated Postgres database. It creates application tables, RLS, contact rate limiting, and the published plan contract. It does not create model, dataset, app, user, or organization records.

Required deployment secrets:

- `PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DATABASE_URL`
- `CONTACT_HASH_SALT`

Store them with Cloudflare secrets or local ignored env files. Do not add values to `wrangler.jsonc` or Git.

## Deploy

```sh
./scripts/deploy.sh
```

The script checks Astro types, validates every language-specific contract, builds the Cloudflare Worker, and deploys only after all checks pass. Astro 6+ uses the unified `@astrojs/cloudflare/entrypoints/server` Wrangler entrypoint for development and deployment.

## Brand

`public/brand/super-ii-logo.png` is an exact byte-for-byte copy of the supplied single-line yellow `Sii` master asset. Layouts crop its original white canvas with CSS; the source image is never redrawn.

## License

Code in this repository is available under the MIT License. The Super ii name and logo are not granted for third-party branding use by that code license.
