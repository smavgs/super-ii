# Curated Ollama model listings

AILocalClick supplies the source catalogue; `tools/sync-ollama-catalog.mjs` reads bounded public manifests and small configuration documents. It does not fetch model weights. The checked-in snapshot contains 266 model families, of which 241 exposed standard model layers when checked on 1 November 2026. Availability is source-dependent; cloud-only and unsupported manifests do not get a misleading weight-download action.

`tools/seed-ollama-catalog.mjs --owner smavgs --out /absolute/import.sql` prepares an explicit, reviewable SQL import. It does not connect to a database. Importing again updates source metadata, preserves curator edits and removed entries, and does not create duplicate listings. A public curator profile must already exist. No users, verified identities, reviews, or hosted repositories are fabricated.

Migration 0044 adds Ollama to external listings and a bounded model-card field. Only a narrow signed-context security-definer function can edit the title, summary and card; it cannot change the owner or source. Existing Hugging Face identity proof and Drive controls remain intact. Ollama entries do not consume the existing 100-card HF/Drive allowance.

Public pages use `/models/{curator}/ollama-{model}` and the existing model-detail layout. They appear in Models and in the curator's searchable, paginated published work. Workspace links to the curator's model list. Original authorship and licensing link to the upstream source; curator ownership is ownership of the listing only. No automated claim or ownership transfer is added.

The browser download request resolves an allowlisted public listing and a strictly validated version tag, checks that the requested digest belongs to that manifest, then streams the selected file. It never accepts an arbitrary upstream URL. Registry-issued redirects are limited to HTTPS Ollama registry and R2 blob delivery hosts; no browser credentials are forwarded. Requests are rate-limited. Private profiles and removed listings fail closed.

The user explicitly chose a relay because direct cross-origin Ollama downloads saved as `data`. The relay sets a correct filename, Content-Length and immutable digest ETag. HEAD resolves metadata without fetching weights. Single ranges, suffix ranges, If-Range and cancellation are supported. Responses are `private, no-store, no-transform`; weights are never written to disk, R2 or Cache API and are never buffered into an ArrayBuffer/Blob. Transfer traffic does pass through Super ii. A finite header timeout does not truncate a legitimate long transfer.

The primary button downloads the main weight file, not an Ollama installation. Required companion files are listed explicitly; complete Ollama installation is an optional command in Use model. Unknown file formats retain `.bin`. Source checksums are displayed as upstream metadata, not a claim that Super ii has scanned or executed the file. Large-file throughput and every model/runtime combination are outside the verified scope.

Validation: functional manifest/destination/range/cancellation tests in `tools/check-ollama.mjs`; real route and signed Postgres role tests in `tools/check-ollama-flows.mjs`; browser proof of a named, complete source-license download with matching checksum; desktop and 390 px layout inspection. Release evidence is recorded separately from implementation.
