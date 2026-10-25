# Quick sharing

Workspace and Create offer a gold **Upload now** action. A native dialog asks for model/dataset, files or a folder, name and format, then license and sharing rights. Format and README suggestions remain editable. The detailed creator editor stays available.

## Computer upload

The dialog uses the existing personal repository create, TUS transfer, quarantine/inspection, presentation, rights declaration and automatic policy submission APIs. It creates no bypass around publication. An original README is preserved; otherwise a factual starter card names the supplied format/license without inventing usage or evaluation evidence. The path limit is 1024 UTF-8 bytes; the quick selection allows 4999 files (leaving room for a generated README) and 10 GiB per file, subject to existing transfer limits.

A random stable slug is the create effect key. Session storage retains only draft metadata, selected paths/sizes and repository/revision identifiers, never file bytes or credentials. After a lost create response, the client recovers the exact member-owned slug. After a lost submit response it reads the authoritative revision state. Existing clean files are skipped only after a matching SHA-256 check. Reloading requires reselecting the same files; the saved draft remains reachable. Ready is shown only for a published revision. Checks that need attention lead to the existing editor.

## Complete downloads

The public model/dataset header links to `/api/repositories/{id}/download?revision={commit}`. The web boundary checks the existing repository read permission and resolves one exact published revision. It makes one credentialed request to `/v1/repositories/{id}/revisions/{revision_id}/download?commit={commit}`, regardless of file count. This avoids the Workers Free external-subrequest limit without upgrading the account.

The runtime independently requires a published model/dataset and published revision. It rejects an incomplete set of clean/available files, unsafe paths, duplicate paths and file/directory conflicts. Standard-library PAX TAR headers preserve Unicode, long paths and large sizes. Each source descriptor is checksum-verified before its content is emitted. Streaming is bounded to 1 MiB chunks, disk reads run off the event loop, and disconnects close open files. No archive-sized in-memory buffer or temporary archive is built.

A generated `SUPERII-RELEASE.json` (prefixed with underscores if necessary to avoid collisions) records repository, exact revision, manifest checksum and each original path/size/SHA-256. Header and metadata bytes plus file hashes determine a strong stable ETag. GET, body-free HEAD, single byte ranges, suffix/open-ended ranges and If-Range support browser/download-manager progress and resume. A changed ETag causes a full response; invalid ranges return 416. Responses are private/no-store. Successful deliveries record one download event; HEAD and incomplete/corrupt streams do not. This is ordinary hosted file delivery, not P2P and not automatic execution. Matching hardware alone does not guarantee software compatibility.

## Optional Drive sharing

Migration 0036 extends external catalog cards with the `google-drive` provider. Existing Hugging Face cards still require verified external identity and a concrete source revision. The narrow security-definer function permits only the authenticated member's public profile, model/dataset kind, validated format and canonical HTTPS Drive file/folder URL, with license, sharing-rights and visitor-access declarations. Exact repeated links reuse the existing active card. Removed cards are not resurrected, the existing 100-card bound applies, and no organization authority is granted.

`/linked/{id}` clearly labels external, unchecked files and opens the supplied Drive destination. A resource key is retained when needed; tracking parameters are removed. Super ii does not connect a Google account, fetch arbitrary URLs, check Drive permissions, import files or promise their availability. The owner must configure visitor access in Drive. A removed card or private owner is unavailable publicly.

## Release order

1. Apply migration 0036 using the migration-only identity; verify existing row counts/data and provider constraints.
2. Deploy the three changed runtime modules; restart only the runtime API and verify readiness plus authenticated package HEAD/ranges.
3. Deploy the validated Worker and verify both public domains, signed-in popup, existing published package delivery and anonymous/cross-origin rejection.

Rollback the Worker to its recorded prior version if needed. The additive Drive schema and unused runtime route are backward compatible and can remain. Restore the runtime module backup if that service fails readiness. Do not remove real member cards or uploads during rollback.
