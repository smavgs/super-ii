# Workspace retro interface — 13 October 2026

## Scope

Workspace and Workroom controls use an isolated visual layer: a recurring alien mascot, selective monospace headings, squared tactile buttons, yellow primary actions, cyan import links, violet agent actions, labelled icons and status badges. The first Workspace visit prefers light; a saved dark preference wins. Other routes keep their existing theme default.

The six Workspace sections, existing permissions, API contracts and publication boundaries remain. The only server-query change reads the existing repository visibility field so that public file links are offered only for published public repositories. There is no migration, new integration, execution service, quota change or credential change.

Work in progress initially shows two recent rooms, with existing search/filter/show-more behavior. Empty Workroom filters stay hidden. Repository rows expose Edit page and, where publicly available, View files. AI guide chips use existing BrandMark assets and existing destinations. Optional Workroom fields use exclusive disclosures; native radio groups expose all eight work kinds and retain keyboard navigation. Invalid optional inputs open their containing disclosure before validation focuses the field.

## Local checks

- Astro type checking and the full production validation/build passed. The final release build must pass again after any subsequent source changes.
- All 35 database migrations were applied twice to disposable PostgreSQL 17. Existing transactional, creator, company product, agent connection and 55 Workroom HTTP/MCP checks passed. No production fixture data was created.
- A browser used the actual local Workroom handlers and disposable database to create a personal Dataset room using arrow-key selection, add a note, edit its next action and verify saved values.
- Repository search filtered the eight-item fixture correctly. Show more exposed all eight and moved focus to the first newly revealed title link.
- The empty fixture hid both unavailable filter groups. Populated Workrooms retained status/search controls.
- AI shortcuts opened the intended guide and closed its sibling. Account showed only the selected disclosure. Card creation dialog opened and dismissed. Agent controls remained disabled without an eligible organization; commerce opened separately.
- An invalid URL in a closed optional section reopened it and received a visible 3px focus outline. Opening the next optional section closed the previous one.
- Light and dark views inspected; phone layouts checked at 390px (Chinese Workspace) and 320px (Russian and English Workroom). No page-wide horizontal overflow in those checks. New interface strings are translated; authored titles and goals keep their language. A pre-existing Chinese dynamic repository count gap was corrected.
- New action text contrast: yellow 12.1:1, cyan 14.23:1, violet 13.14:1 against navy. Muted copy on the cream surface is 5.37:1. Input borders exceed 3:1 on light surfaces. Reduced-motion and forced-colour rules preserve keyboard selection and focus.

Evidence: local release folder `superii-workspace-pixel-release-2026-10-13/`.
Browser fixtures and proxy are local-only and removed from the release tree.

## Release dependency patch — 14 October 2026

The required RustSec check found three advisories against the existing `quinn-proto` 0.11.17 lockfile entry: RUSTSEC-2026-0343, RUSTSEC-2026-0340 and RUSTSEC-2026-0338. The lockfile now selects upstream's patched 0.11.18, with no other dependency changes. Locked Rust tests, Clippy and the required RustSec workflow must pass before release; final outcomes are recorded in the release report.

## Remaining boundaries

Responsive viewport checks are not real mainland-network or WeChat-device verification; those remain deferred. This is not a complete assistive-technology audit. Local Card and agent lists used empty fixture responses, not production credential mutations. Public deployment and final CI evidence are recorded separately in the release report.
