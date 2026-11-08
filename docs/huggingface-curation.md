# Curated Hugging Face datasets and apps

The supplied November 7 collection adds 100 robotics dataset descriptions and 100 Hugging Face Spaces to @smavgs. These are attributed external listings; original projects and files remain with their creators on Hugging Face. Source metadata was read without credentials. Provider metrics retain HF labels and a checked date. Descriptions are curator-provided English text; controls support English, Russian and Simplified Chinese.

## Reader experience

Existing Datasets and Apps catalogues open local detail pages at `/{datasets|spaces}/{curator}/hf-{listing UUID}`. The profile's existing Work tabs, search and pagination include curation once; they do not repeat it in Linked work. Original creator, source, license and access status stay visible.

Files loads one folder of up to 30 entries at a time at the stored commit SHA. Public files download through a streaming endpoint with attachment filenames, HEAD and single-range/resume support. Metadata and transfer redirects are bounded and restricted to Hugging Face's hosts. No provider credentials or browser cookies are forwarded. Current public/gated access is checked on each request; neither metadata snapshots nor a Super ii login confer access. Complete datasets and app environments are not misrepresented as a single installer; the Use locally tab gives an exact-revision CLI command.

Apps launch only on request inside a sandboxed iframe. Each page's CSP permits only its validated `hf.space` origin, and availability is checked before launch. A visible source link covers apps requiring login, payment, permissions or unsupported embedding. No Super ii user data is automatically sent into the iframe.

## Ownership and import

Migration 0048 adds an explicit `is_curated` flag. Curated HF rows are limited to exact-source dataset/space metadata and remain separate from verified-namespace creator links. Backend roles cannot insert or directly mutate these rows. The signed owner-only edit function changes the title, summary and Markdown description, preserving upstream attribution. Curation does not consume the member's existing 100 HF/Drive sharing allowance.

`node tools/seed-huggingface-catalog.mjs --owner smavgs --out /absolute/import.sql` prepares reviewable SQL; it does not connect to the database or fetch files. Apply with the existing migration role after 0048. Imports preserve curator edits, creator-owned links and removed entries. Unknown repository file totals are stored as unknown (zero metadata counts), never presented as a zero-byte dataset. Large-source storage figures are not treated as download sizes.

The migration runner replays all migrations. Migration 0044 defers its source-revision constraint once 0048's flag exists, so replay cannot reject already-imported curated HF rows. The isolated Postgres suite tests this with populated curation.

## Verification

`tools/check-hf-catalogue.mjs` covers source records, bounded metadata, access restrictions, path validation, pagination, download host restrictions, HEAD and ranges. `tools/check-hf-catalogue-flows.mjs` uses actual restricted routes and signed Postgres contexts for owner isolation, private profiles, gated sources, repeatable 200-item import, preserved edits/removals and normal sharing allowances. It runs in `npm run db:test`; unit checks run in `npm run validate`.

The November 6 Sigma pack is a separate content publication: 15 stories, 45 language versions and 29 images, published through the existing editorial gateway. No newsletter campaign was sent.
