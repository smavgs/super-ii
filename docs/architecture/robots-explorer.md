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
- [x] Run PostgreSQL, API, build, security and rendered-browser checks with disposable local data. Merge and deploy the initial release, then inspect live read/access boundaries. Release-specific CI and deployment evidence is recorded in the verification report and local release directory.

## Trust and data boundaries

Reference data is attributed to the supplied Robots.com collection and its per-fact sources. Original external images remain sourced. The separately supplied Drive collection adds 787 reviewed product photographs (198 robots, 73 hands, 516 component representatives) as local WebP delivery assets, with original and delivery hashes in `src/content/robot-supplied-media.json`. Originals remain in Drive; the importer changes encoding and bounded size, not composition or product appearance. White media canvases do not remove backgrounds embedded in source photographs. Broken or absent images have an honest text fallback. Company origin and manufacturing location are distinct; no manufacturing location is invented. Source assertions are not hardware testing or endorsement.

`Super ii reference`, `Company maintained`, and `Community build` describe page responsibility. Company authority uses the existing website-control proof plus signed-in owner/admin authorization and an explicit authority declaration, or a reviewed request; email access alone grants no ownership. Existing claims cannot be overwritten. The public catalogue only exposes published company snapshots and explicitly published community robots; draft changes never leak into discovery.

## Product experience update — 29 October 2026

The detail dialog follows the model-page layout: compact actions, selected content tabs, gallery plus a facts/metrics column, mint/yellow/lavender controls and red-gradient contact/claim actions. Reference provenance remains in machine-readable snapshots and per-spec evidence rather than repeated front-page boilerplate. Product images are not outbound links. Same-origin asset paths work on both canonical domains.

A claim can cover one reference product or its company. Migration 0043 preserves whole-company proof and review while adding product-scoped claim records, serialized competing claims and separate request uniqueness. A product-only claim cannot prepare or publish other reference products. Existing whole-company access requests redirect to an explicit company scope, because approval grants organization administration. Previously claimed products retain their own responsible organization when the company is later claimed. Team membership applies to its organization, and no claim implies physical robot access.

Companies can publish contact details without publishing unrelated private company drafts. Signed-in visitors explicitly consent to sharing an inquiry's product, topic, message and reply email. The company's private Workspace inbox shows the inquiry and allows replied/archive status. Email links open the user's mail application; Super ii does not send or verify delivery of those emails. A first contact is free and does not create a Social web post. Sender-scoped idempotency keys prevent duplicate retries, and a daily 20-inquiry limit and network request limits bound abuse.

Public counters show likes and daily deduplicated product opens, not sales, unique people or verified demand. Likes require a signed-in human and are idempotent. Views use daily salted network hashes; no raw network address is stored in view records. Hash rows older than 31 days are pruned on subsequent recording; aggregate counts remain. Inquiries and like identities are not exposed through public APIs. All new tables use RLS with no direct service-role table grants; narrow database functions enforce authorization.

Company country/region selection accepts 249 ISO codes and presents localized flags and names. Source collection origin labels were reviewed for Korean evidence; no South Korean manufacturer was positively identified in the supplied entries. Do not infer origin from a factory location or change flags without supporting evidence. A local Korean-country fixture proves selection and filtering only, not a real company-origin finding.

Current release verification is recorded in `qa/ROBOTS-EXPERIENCE-2026-10-29.md`.
