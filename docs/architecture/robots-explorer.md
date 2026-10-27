# Robots explorer

## Approved direction

Robots lead discovery. The existing `/robot` planner remains **Make Robot**; `/robots` is the compact public **Explore robots** surface. The homepage's fourth discovery tile becomes Robots, while Organizations stays in the directory. The supplied 2026-10-21 reference collection contains 329 companies, 1,217 products, 97 product families and 15,190 sourced specification entries. Its current company-origin coverage is China; it is not a worldwide completeness claim.

Visual thesis: real robot photographs and manufacturer marks inside Super ii's established crisp yellow/navy, monospace and pixel-control system, with compact editorial spacing.

Content plan: compact title/search/actions; a paginated robot gallery; a searchable, paginated company directory; the existing footer. A single shared detail dialog holds Overview, What's inside, and Specs & files. The approximate two-screen budget applies to the discovery surface, not long technical documents.

Interaction thesis: card hover/focus indicates opening; one restrained dialog entrance keeps context; tab/variant selection replaces detail content in place. All motion respects reduced motion. Mobile uses a full-height detail view, with Back/Close, restored focus and unchanged discovery filters.

## Implementation and release checklist

- [x] Import the supplied facts, source links, country labels and original image links reproducibly, without copying another site's UI or executing its captured scripts. Keep source dates and missing data visible.
- [x] Add paginated product/company discovery, family selection, full specification sources, original resource links, stable share URLs, QR and machine-readable detail.
- [x] Add evidence-labelled part connections. Never infer installed components from a shared manufacturer or a similar name.
- [x] Reuse Organizations and the existing product editor for company maintenance. Claims require verified authority, preserve public URLs and prevent duplicate ownership. Pending claims/corrections remain private; existing owners receive access requests.
- [x] Add explicit community publication with project stage. Saving a new plan is private until its creator publishes it.
- [x] Support maintainable galleries and complete specifications with bounded input/storage, retaining a three-active-upload allowance rather than unlimited storage.
- [x] Add EN/RU/ZH interface labels, keyboard/focus/error handling and responsive browser verification.
- [ ] Run appropriate PostgreSQL, API, build, security and rendered-browser checks with disposable local data. Merge, deploy additive changes, inspect live read/access boundaries, and wait for completed final CI.

## Trust and data boundaries

Reference data is attributed to the supplied Robots.com collection and its per-fact sources. Reference photographs/logos remain explicitly sourced external images; they are not copied into Super ii storage without a separate upload. Broken or absent images have an honest text fallback. Company origin and manufacturing location are distinct; no manufacturing location is invented. Source assertions are not hardware testing or endorsement.

`Super ii reference`, `Company maintained`, and `Community build` describe page responsibility. Company authority uses the existing website-control proof plus signed-in owner/admin authorization and an explicit authority declaration, or a reviewed request; email access alone grants no ownership. Existing claims cannot be overwritten. The public catalogue only exposes published company snapshots and explicitly published community robots; draft changes never leak into discovery.
