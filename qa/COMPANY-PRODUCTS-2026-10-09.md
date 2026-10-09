# Company and product home — local verification

Status: release candidate, not production verification. No production company, product, contact, inquiry, repository or uploaded file was created or changed during these checks.

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

## Remaining limits

- Browser image selection/upload was blocked by the Chrome extension's disabled file-URL access. No browser permission was changed. The local image preview uses the same bounded rasterized JPEG preparation as upload. Existing image handling, ownership and the lifetime counter have automated coverage, but this release does not claim a fresh browser upload succeeded.
- Production migration/deployment, live public reads and authenticated Workspace entry need separate verification after merge.
- Mainland mobile, WeChat completion, actual exhibitor onboarding, delivered inquiries, large company catalogs and real-world product quality are unverified. They are not implied by the local tests.

## Reproduce local browser QA

Run the normal Astro development server on loopback port 13426, then `SUPERII_PRODUCT_PREVIEW=1 npm run db:test`. The test suite creates an isolated PostgreSQL container and exposes its editor at loopback port 13425. It temporarily creates three DEV-only pages under `src/pages/workspace`; stop the product-flow process with SIGINT so the helper removes those pages and fixtures and the parent script removes the database container. Never commit or deploy the temporary pages.
