# Workspace destinations — 17 October 2026

## Scope

Create & upload (`/new`), Bring my work, Company and product, Agents and the Agents commerce deep link now share Workspace's retro controls. A compact navigation, alien mascot, monospace headings, squared controls, yellow primary actions and cyan/violet accents replace the disconnected introductions. Saved light/dark preferences remain respected.

The existing creator and product editors retain their data, uploads, previews and publication handlers. Bridge keeps source discovery primary, folds history and supporting information, and opens activity when a job is active. Agent clients open one setup at a time; configuration text and verification status still come from the existing registry. Permissions, public agents and protocol documentation open on request. Hash links reveal their containing panels and move focus, including `/agents#commerce-lane`.

No backend, migration, authority, entitlement, quota or dependency was added. ProductEditor receives an optional embedded heading mode only on the new-product route. Shared control selectors now also include this layout; existing Workspace and Communications rules retain their declarations. Russian and Chinese interface translations include the new labels.

## Verified locally

- Astro check: 503 files, 0 errors, 0 warnings, 3 existing hints. Full validation and the final production build passed; the release scan inspected 566 files without finding private local values. The final small copy/contrast changes were included in the rebuilt release.
- Chrome at desktop width: Create details, automatic address suggestion, starter README and live preview; Product company/product section exclusivity and live title/summary/company preview; Bridge discovery and result selection controls; exclusive Codex/OpenCode setups; commerce hash opening its outer and inner panels with focus.
- All five requested destinations fit at 390 pixels with one main landmark and no page-wide horizontal overflow. Russian Create, Bridge, Product and Agents fit at 320 pixels. The Chinese commerce deep link also fits at 320 pixels and reveals the correct translated panel.
- Light and dark views were inspected for the editors, Bridge and commerce. Scoped text-button contrast was corrected in dark mode. Keyboard focus remains visible; reduced-motion and forced-colour rules are retained. This is not a complete assistive-technology audit.
- Submitting the local empty creator form reveals Page details and focuses Title. An invalid repository address focuses that address and remains inside the open panel. Both editor address patterns now escape hyphens correctly under HTML's Unicode-set regular expressions. The regression check compiles the actual markup and verifies representative valid and invalid addresses.
- Form data and the Bridge discovery response were disposable examples in an isolated local preview outside the repository. Creator submission was in demo mode. No production repository, product, import, token or purchase was created or changed by these checks.

## Evidence boundaries

Local screenshots and logs are in the operator's `superii-journeys-release-2026-10-17` folder. The preview copies have no account secrets, contain an explicit LOCAL PREVIEW banner and are not release sources. Local form/preview checks do not establish a new authenticated upload or import result. The available production browser was signed out; production checks will cover public rendering and access boundaries. Mainland mobile/WeChat testing remains deferred.

PR checks, merge, deployment and post-deployment read-only checks are recorded separately once completed. Owner verification is not independent member review.
