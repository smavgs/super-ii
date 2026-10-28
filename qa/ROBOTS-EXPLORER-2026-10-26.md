# Robots explorer verification

Started 2026-10-26; release work continues 2026-10-27. This record separates local evidence from deployment. No production test company, claim, product or community robot has been created.

## Scope

- `/robots` opens on complete robots; hands/components remain searchable. Six product cards and twelve company tiles are paginated, with an A–Z company filter, country flag and written origin.
- A single detail panel contains overview, galleries, family variants, sourced specifications, resources and documented component connections. Direct URLs and QR retain the selected company/product. `/robot` remains Make Robot; the homepage fourth discovery tile is Robots and Organizations stays in the directory.
- The reproducible importer preserves the supplied snapshot: 329 companies, 1,217 products, 97 explicit families, 15,190 specifications, maximum 212 specifications for one product. Source capture: 2026-10-21. Current reference company-origin coverage is China, not a global completeness claim.
- Private claims reuse Organizations and company product drafts. Matching official DNS control plus authority declaration or staff-reviewed evidence is required. Existing owners/admins approve access; owners can remove non-owner membership. Pending linked reference products cannot publish. Approved publication retains the original reference URL; pausing does not resurrect the old reference.
- New community plans begin as drafts. Publication is a distinct owner-authorized action with an owner-declared build stage.
- Galleries retain three active Showcase uploads per member; removing an image frees a slot. Total storage and input bounds remain. Up to twelve total local/external gallery images and 256 specifications accommodate the supplied records.

## Local evidence

- PostgreSQL 17: 40 migrations applied twice; all existing security, product, creator, quick-sharing, Workroom and other integration suites passed in a disposable database, including the final team-control changes.
- The final focused explorer suite passes 53 actual HTTP/restricted-database checks: anonymous/wrong-owner refusal, exact-domain claim proof, declined/resubmitted claims, retry idempotency, owner-approved access, owner-protected removal, revoked access and resubmission, private drafts, all imported seed documents valid, maximum 212 specs, stable published IDs, pause, and explicit community publication/unpublication. DNS proof is established as a local checked fixture; real DNS resolution has an existing Worker regression suite.
- Type/Astro check: zero errors and warnings. Production build, all static validators, schema checks, the real product Worker regression and the release secret scan passed after browser corrections.
- Browser preview uses the actual source and restricted local Postgres, with a fake local human context only on private routes. It contains no production credentials or production data. Preview-only Clerk missing-key logs are expected. Desktop 1280 px, English/Chinese 390 px and Russian 320 px discovery fit without horizontal overflow. The desktop explorer section measured 1162 px high; the mobile section measured 1527 px before the small specification-wrapping correction. The detail panel fills the 390 px mobile viewport. Component trail, source/specification accordion, QR image, copy feedback and Escape focus restoration were verified. Local company request and prefilled private product draft were also exercised. Product/company search and component variant switching passed. Dark-theme fallback labels remain readable.

## Source and capability limits

- The folder supplies image links, not image bytes. Original Robots.com image requests returned 403, including in Chrome. No challenge or access restriction was bypassed.
- Official manufacturer sources supplied visually reviewed galleries for 14 products and 87 company logos. The other records use labelled image/logo fallbacks. These are external images, so source availability can change. Images may depict optional configurations.
- One documented connection is included: Unitree Dex3-1 as an optional G1 EDU configuration. It is not labelled standard G1 equipment. Undisclosed components and complete bills of materials are not invented.
- Public REST/JSON and `/robots/agents.md` support anonymous agents. The existing MCP tools are unchanged. Claims, team access and publication remain human-authorized; no actuator or payment authority is added.
- First manufacturer ownership, a real exhibitor journey, mainland mobile/WeChat operation and physical hardware quality/execution remain unverified. Browser viewport checks do not substitute for device/network testing.

## Release

PR #138 merged as `adb854b97514db12e164e81ad259930d26ffe82b` after every PR check succeeded. Post-merge Validate and build, CodeQL and Secret scanning also completed successfully.

Migrations 0037–0039 added the genuine reference collection and maintenance controls. All existing app-table counts and core fingerprints were unchanged in the migration transaction and an independent committed-state check. All 124 application tables have RLS. Claims, claim requests and maintained reference links remain empty; no production fixtures were created. Later signed-in page access changed only the profile fingerprint; the migration-time comparison is the preserved-data evidence.

Feature Worker `20d4155e-7576-4f3d-bbab-0ff8913576a7`, deployment `2c6e0025-98a5-449b-9c1f-71cf88d7ac91`, serves 100% of both domains. Previous Worker: `4b677759-a822-4d06-92d1-52d10b018659`. Runtime services were not changed.

The first live check exposed catalogue query latency near the existing 15-second service timeout. Production EXPLAIN showed 11,724 ms, mostly redundant maintained-product lookups for references with no maintained product ID. Migration 0040 makes that lookup strict: NULL immediately returns NULL, preserving output and grants. After the 53 focused checks passed locally, this operational repair was applied. Measured production database execution was 59.8 ms afterward; this is a measured query sample, not a load or throughput claim. The complete 40-migration PostgreSQL suite also passed.

Thirty live checks now pass across both domains: EN/RU/ZH discovery, products, company pagination, detail, search, bounds, missing IDs, QR SVG, agent guide, source manifest, anonymous write refusal and wrong-origin refusal. The measured catalogue HTTP requests took 0.83–2.27 seconds from this connection. Desktop Chrome confirmed the homepage Robots entry, six robot cards, product gallery, sourced optional Dex3-1 connection, specifications, source links and Escape focus restoration. A live QR visibility issue was corrected in the follow-up: image fallback detection must not hide an image before it has a source, and the QR action clears a prior hidden/error state.

The QR correction was checked in the actual local preview: the 180-pixel image loads and is visibly displayed, including in the narrow in-app browser. The follow-up contains the small query/QR repairs, truthful active-image quota wording and this release record. Its final merge, bundle deployment and browser QR verification are recorded in the local release evidence directory after completion.
