# Company and product home — release verification

Status: deployed through PR #95; production verification recorded on 2026-10-10. No production company, product, contact, inquiry, repository or uploaded file was created or changed during these checks.

## Implemented journey

Workspace → company and product → save private draft → preview → explicitly publish → product page, contact channels, bilingual sheet and QR. Companies can present models, robots, components and hardware without publishing source code. Existing organization membership, personal Cards, repository creation and Robot engineering remain separate. Three successful Showcase uploads over a member account's lifetime remain the limit; selecting existing company images does not use another upload.

The public JSON, Markdown, REST, MCP and A2A paths read published snapshots. Field retrieval links to supplied evidence and reports missing details. It does not infer product quality or certify company claims. Optional DNS TXT verification establishes control of an exact hostname only.

## Automated verification

- PostgreSQL 17: all 34 migrations applied twice; existing transactional, agent-connection and creator suites passed. The company product HTTP suite uses signed restricted database contexts and checks create/retry, private drafts, browser reads without Origin, cross-origin writes, ownership, stale product/company edits, publication/pause, private snapshot preservation, cross-company image rejection, lifetime quota, Card revocation and exact DNS challenge binding.
- Real MCP HTTP tool calls and A2A reads see the published snapshot and reject paused products. No new agent write authority is granted.
- Product unit checks cover bounded document/JSON schemas, public URL/IP/redirect constraints, source metadata as untrusted data, response-size limits, exact TXT binding, English/Chinese field retrieval and unknown battery specifications.
- The existing full validation/build, type/template checks, localization coverage and private-value scan are required before release. Final results are recorded with the release outside this source tree.

## Browser verification

Chrome used a loopback-only proxy with the actual editor, public presentation and API implementations, a disposable PostgreSQL database and a mock object store. The explicit local identity is a test fixture; it is not production sign-in verification.

- English draft creation, save/reload, specification/resource editing, publication, public page, QR and published-field lookup were inspected.
- Simplified Chinese draft creation, save/reload with language retained, resource selection, explicit publication, copy-link result and bilingual sheet were inspected. Pausing the product made its public sheet unavailable.
- Desktop preview and one-section-at-a-time controls were inspected. A 390px viewport had a 390px document width, one expanded section and a collapsible preview. This is browser responsive testing, not an actual mainland or WeChat mobile test.
- Print CSS displayed company and product names, supplied English/Chinese purpose and resource labels, contact, stable URL and QR while omitting website navigation. Physical printing and a downloaded PDF were not tested.
- User-authored text remains excluded from automatic interface translation. A Chinese-only name receives an editable ASCII URL suggestion.

Local screenshots are stored in the release directory as `local-chinese-editor-390.png` and `local-bilingual-sheet.png`; they contain explicitly disposable fixture content and are not a live catalog.

## Production verification (2026-10-10)

- PR #95 merged at `87198c7b16d640a47e1b628a00bedf442cd618fb`, matching the tested source tree. All eight required checks, aggregate CodeQL and triggered post-merge workflows passed. The owner approved the scoped merge override after those checks passed.
- Migration 0034 was applied once. All three new tables retain RLS; backend roles have no direct table CRUD or public function execution. All 17 function grants match the intended narrow roles. Existing repository and business-data fingerprints stayed unchanged.
- The initial product Worker deployed as `3062d772-dad7-40a4-ac0f-a554121394ec`. Subsequent PR #97 and Worker `c6ace4d6-f20b-4c8f-a0fa-627abd180880` are preserved by the release follow-up.
- Ordinary unauthenticated clients passed 35 product checks on each canonical/www host, including catalog/schema/contract reads, MCP and A2A, unavailable-product responses, authentication and cross-origin rejection. The existing machine-access checker passed 40 checks per host. Empty published company catalogs remain honest; no fixtures were seeded.
- The existing host-scoped Cloudflare browser-integrity exception now includes only the product `product.json` and `product.md` machine representations. Those paths reach application-level 404 responses for missing products; ordinary requests to the human-facing directory retain the existing browser check.
- Signed-in Chrome reached the real Workspace editor with draft and publish controls. English, Russian and Simplified Chinese interfaces were inspected. A 390px Chinese editor had one expanded section and no page-wide overflow. These checks read production state; they do not claim a new live company was published.
- Live source-suggestion testing exposed an unsupported `redirect: "error"` mode in the Worker DNS fetch. The follow-up uses `manual` and rejects non-success responses, preserving the no-redirect DNS policy. `tools/check-product-worker.mjs` runs the actual Workerd Request implementation and covers metadata, exact TXT matching and rejected DNS redirects. A separate real-network Workerd read successfully returned the Example Domain title. The final deployed source-suggestion result and Worker version are recorded in the external release evidence directory.

External release evidence folder: `superii-company-products-release-2026-10-09`. It contains the database verification, both-host HTTP results, Cloudflare scope, workflow results, deployment logs and real production screenshots. The filename date identifies the original release preparation; the live machine-path checks above were completed on 2026-10-10.

The production npm audit returned zero vulnerabilities. This does not mean the repository has no advisories: pre-existing CodeQL alert #8 in the unchanged vendored HTTP cache and five moderate Python dependency alerts remain separately recorded. No new PR #95 source alert remained open.

## Remaining limits

- Browser image selection/upload was blocked by the Chrome extension's disabled file-URL access. No browser permission was changed. The local image preview uses the same bounded rasterized JPEG preparation as upload. Existing image handling, ownership and the lifetime counter have automated coverage, but this release does not claim a fresh browser upload succeeded.
- Mainland mobile, WeChat completion, actual exhibitor onboarding, delivered inquiries, large company catalogs and real-world product quality are unverified. They are not implied by the local tests.

## Reproduce local browser QA

Run the normal Astro development server on loopback port 13426, then `SUPERII_PRODUCT_PREVIEW=1 npm run db:test`. The test suite creates an isolated PostgreSQL container and exposes its editor at loopback port 13425. It temporarily creates three DEV-only pages under `src/pages/workspace`; stop the product-flow process with SIGINT so the helper removes those pages and fixtures and the parent script removes the database container. Never commit or deploy the temporary pages.
