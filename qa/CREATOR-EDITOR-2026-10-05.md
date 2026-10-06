# Creator editor verification — 2026-10-05

Release candidate; production rollout is recorded separately.

## Browser verification

Real Chrome on macOS, using a temporary local fixture route built from the shared CreatorEditor component. The route was removed before the release build. No production repository was created or changed.

- Create and existing draft layouts; title editing and Markdown formatting update the preview.
- Native folder selection with README.md, config.json and images/example.png preserves nested paths and selects three files.
- README front matter suggests title, URL name, license, library and task. Body preview hides front matter, renders the table, and loads the local PNG through a browser blob URL.
- One top-level editor panel remains open at a time. Enter on the focused summary operates the disclosure.
- Published fixture fields remain disabled with a separate Edit this page action.
- Russian and Simplified Chinese controls are translated while the author card stays in its original language. Queue filenames are explicitly excluded from translation after a browser check caught the issue.
- At 1280 px: two-column writing and preview. At 390 px: one column, document width 390 px, no page-wide overflow. Temporary viewport overrides reset.

Local screenshots are in qa/evidence/creator-editor/: 02-desktop-draft.png, 03-chinese-mobile.png, 04-russian-published-mobile.png and 05-folder-image-preview.png. These fixture screenshots are not production publishing evidence. The fixture had no Clerk keys, so its expected missing-authentication-key diagnostics do not establish an authenticated browser upload.

## Automated verification

- Astro type/template checks: zero errors, zero warnings; one pre-existing deprecated copy-command hint.
- Full site validation and production build pass. Built security checks pass; 509 release files scanned for private values.
- PostgreSQL 17 migrations apply twice. Existing integration tests, signed restricted-role agent flows, and new creator tests pass.
- New API tests: fresh personal draft with empty optional summary, missing authentication, cross-owner denial, exact clean README binding, stale version and wrong revision rejection, private preview isolation, unpublished anonymous download denial and clearing the card when its README is removed. The API harness uses real PostgreSQL authorization contexts; storage download bytes are mocked.
- New SQL tests: presentation initialization/inheritance, no draft leak into repository metadata, public presentation sync, published immutability, missing/mismatched README rejection, runtime-only Bridge finishing, import replay and atomic completion.
- Runtime suite: the final full suite, including the additional README inspection test, passed all 120 tests.
- Markdown and creator tests: bounded front matter, unsafe markup and URL exclusion, uploaded image allowlist, external-image links, nested folder path validation, template claim limits and translated control coverage.

## Practical limits

The browser fixture validates selection and presentation; it does not certify a fresh real-user publication, a large production model upload or a completed live Bridge import. Existing transfer runtime tests remain the evidence for checksums, recovery and scanning. A new creator still needs valid files, storage entitlement, license/provenance declarations and passing publication checks. Card formatting does not manufacture model-quality evidence.

## Release gate fixes — 2026-10-06

The required RustSec workflow now runs on every pull request. Its former path filter could leave GitHub waiting for a check even when a manually dispatched audit passed on the same commit.

A fresh npm audit flagged three existing dependency advisories. The lockfile now resolves proxy-addr 2.0.8 and source-map-js 1.2.2. A narrowly scoped ONNX installer override uses global-agent 4.1.3, removing its vulnerable roarr/sprintf-js chain. The installer bootstrap and HTTP proxy behavior are exercised against a local server by `tools/check-onnx-installer-dependency.mjs`. Transformers.js, the browser tokenizer package, ONNX engines and all four shipped WASM assets retain their existing versions and bytes. `npm audit --omit=dev` reports zero known vulnerabilities for this resolved tree.

## Browser read correction — 2026-10-06

The first production rollout exposed a missing browser case: the shared authorization helper required Origin on GET, but same-origin browser fetches and image requests omit it. The API fixtures had incorrectly supplied Origin on every request. Draft preflight and private image reads could therefore be rejected despite a valid signed-in owner. The previous Worker and runtime were restored while preparing the correction; the additive migration and original public cards were retained.

The two read routes now explicitly accept same-origin Fetch Metadata or a same-origin Referer fallback. New integration cases omit Origin for normal reads and cover anonymous denial, other-owner denial, cross-site and same-site denial, malformed/cross-origin Referer, conflicting Origin, image request headers, and unchanged write Origin requirements. Existing revision, README, file-isolation and concurrency cases still run against isolated PostgreSQL roles. PostgreSQL replay/integration tests, type checks and the complete build pass. This correction does not grant anonymous access or new token scopes.

A local Chrome probe bundles the real authorization helper with an isolated fake profile/SQL adapter. Native fetch and image requests both omitted Origin, supplied Sec-Fetch-Site: same-origin and were authorized; native POST supplied its exact Origin and was authorized. This confirms browser-header compatibility separately from the real PostgreSQL authorization tests; it does not claim a production upload.
