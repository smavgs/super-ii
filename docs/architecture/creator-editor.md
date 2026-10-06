# Shared creator editor

The Create page, repository workspace and Bridge finishing route share one editor for files, page details, Markdown and preview. Keep Super ii's yellow/navy identity, use a compact working surface, and show advanced tools only on request. Preview updates and upload progress provide feedback; respect reduced motion.

Files and source links lead into editable suggestions. No generated template asserts training, ownership, benchmarks or verification. Local files remain in the browser until the creator starts an upload. Folder selection preserves paths beneath the selected root.

Page presentation belongs to a revision. Draft edits must not change a published page. README.md is the card source whenever present: editor saves upload that file through the existing checksum/scanning path; runtime inspection synchronizes the bounded UTF-8 README for all clients. Published revisions lock presentation. Existing cards are retained during migration.

Repository Markdown supports clean repository image files via scoped file URLs. External images remain explicit links; arbitrary HTML, scripts, SVG and tracking images are never automatically rendered. Preview and public rendering share the same code, including front-matter removal and imported asset resolution.

Browser Bridge imports opt into finishing in Workspace. They retain exact-source provenance and checks but wait as an editable draft for the creator to preview and submit. Existing automatic API/sync imports keep their behavior.

Validation covers metadata isolation, immutability, conflicts, README consistency, Markdown safety, folder paths, template honesty, resumable transfers, Bridge draft completion, responsive layout and localized controls. Production completion must be reported separately from implementation and local verification.

## Deployment and recovery

Apply migration 0033 first, then update the offline runtime and Bridge worker, then deploy the control-plane Worker. The migration snapshots legacy presentation without changing published repository content. Do not reverse the additive migration during a frontend rollback. Roll back the Worker and runtime code together if necessary; retained revision presentation is not destructive.

The editor checks the current revision and presentation version before uploading, then uses a compare-and-swap save after scanned README upload. This detects stale editor sessions and prevents silently overwriting newer presentation. File uploads retain the existing transfer semantics: concurrent uploads are not a whole-repository transaction. A failed save preserves uploaded bytes and reports the conflict; publication rejects any mismatch between the card and its clean README.

The authenticated `GET /api/repositories/:id/presentation?branch=:branch` exposes only the current revision, presentation version and editability. `POST` requires the same current revision, expected version, bounded page fields and a card matching the scanned README. Both use the existing repository commit scope. Private image previews use the repository read scope and only the selected branch head; published downloads keep their existing route.

Browser GET requests for presentation and private previews normally omit `Origin`. Those two reads also accept browser-controlled `Sec-Fetch-Site: same-origin`, or a same-origin `Referer` when Fetch Metadata is absent. An explicitly different Origin, cross-site/same-site Fetch Metadata or missing origin evidence remains denied. Profile authentication and repository authorization still apply. Writes retain the exact Origin requirement, and scoped bearer-token handling is unchanged.

Browser Bridge requests set `finish_in_workspace: true`. Legacy API requests without this opt-in keep automatic policy completion. The request fingerprint reuses an existing import without changing its completion mode. Holding a finished import requires recorded source provenance and no publication decision, is runtime-only and is repeatable; it cannot reopen a published revision.
