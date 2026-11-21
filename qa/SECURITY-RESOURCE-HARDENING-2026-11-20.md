# Security resource hardening verification

Status: deployed 2026-11-21, with the verification boundaries below. PR #181 merged at `1c23fe0a887f06d594fcac81b8513886769d5510`; all required PR checks and the post-merge build passed. A separate configuration correction retains the existing Workers Free plan.

- Full PostgreSQL 17 migration/integration suite passed, including repeated migrations, isolated grant/denial, OAuth quota and wildcard checks, and stale authentication followed by fresh connection approval.
- Astro check, site validation and release build passed. Built secret/static HTML checks passed.
- Python runtime: 143 tests passed. SDK: 45 passed, five explicitly skipped. Publication-service checks and Docker image/config validation passed.
- Rust transfer tests cover bounded concurrency, owner/global reservation limits, restart recovery, second-writer refusal, low disk, slow/oversized/disconnected/cancelled uploads, crash tails, checksums, resume, promotion, expiry and stalled downloads with Range support. A date-format regression test retains old RFC3339 strings, offsets and nanoseconds.
- The strict RustSec audit identified RUSTSEC-2026-0543. Replacing chrono with time removes the affected dependency; required denied-warning checks remain enabled.
- Worker dry-run accepted the configuration, but the first real upload rejected the custom CPU ceiling because production uses Workers Free. The unsupported override was removed; the existing Free-plan ceiling remains. Production secret-name inspection confirmed CONTACT_HASH_SALT and OPENROUTER_API_KEY exist, without printing their values.
- Chrome local fixture: cancel and Escape cause no grant; wrong code remains rejected; success performs exactly one retry; original work selection remains. At 390 px the dialog fits the viewport, focus returns to the invoking button, and no page-wide overflow occurs. This fixture mocks Clerk and is not a real production code/grant exercise.
- Existing live runtime inspection found 41 available transfer records and zero pending bytes. No production fixture uploads or new credentials were created.

## Account-side changes verified in the dashboard

- OpenRouter existing `superii` key: US$50 monthly credit limit. This is not a platform-wide bill cap.
- Clerk production: block disposable emails enabled; user enumeration prevention set to Strict. Existing bot-signup protection and account lockout remain enabled.
- Clerk production MFA/passkeys remain unavailable on Hobby. The operator explicitly chose the free plan on 2026-11-21; no subscription was purchased.
- Clerk and Private Email DKIM DNS records exist. An older Clerk email passed alignment, but complete current sender validation and stronger DMARC enforcement remain pending.

No production stress test, independent penetration certification, full provider-email exercise or hostile compute isolation is claimed. Keep the canonical capability register conservative until release evidence is recorded.

## Dependency refresh

The initial GitHub inventory contained 277 open alerts across repeated Python dependency manifests. Targeted compatible upgrades cover all available fixes from that inventory. After refreshing all six locks, OSV scanned 238 distinct package/version pairs and reported only the known Accelerate 1.14.0 issue (GHSA-4j2p-28q2-5m79 / PYSEC-2026-3804), for which immutable-snapshot shard checks remain required. npm audit reported zero advisories. RustSec reported zero denied advisories after chrono removal. Counts are point-in-time evidence, not a guarantee against future vulnerabilities.

## Production rollout, 2026-11-21

- Migration 0051 applied; OAuth function owner and grants are unchanged. Repository count remained eight and OAuth client count remained four. No synthetic client, token or public repository was created.
- The Rust binary SHA-256 is `cec85bebf0c9a6491e486c889eb570ff6f6062fc69ef5549ad32c67159f1f604`. Its health reports the configured admission/storage/time limits. A four-byte authenticated Range read from an existing stored object returned 206 and the exact original bytes. Published weights were not copied or modified.
- Runtime dependencies were installed in a separate environment before cutover. The previous environment and changed files remain available for rollback. The first launchd bootstrap raced service shutdown; the old environment was restored, then the switch was retried after old processes exited. Final readiness reports database, storage, transfer service, ClamAV, Gitleaks and publication policy healthy. The pre-existing installed GGUF tokenizer enhancements were preserved.
- Installed Python checks confirmed Pillow 13.0.0, certifi 2026.10.23, filelock 4.2.12, Gradio 6.32.0, Torch 2.14.1 and Diffusers 0.42.1. Runtime/service imports and an image roundtrip passed. The rebuilt Gradio container passed imports and an image roundtrip without network access; notebook and transfer images were rebuilt. These are not GPU workload benchmarks.
- Worker `ed1ef006-3d80-42b1-ad2b-ce221f6389c1` deployed with both rate bindings, canonical domains, existing R2 binding and hourly maintenance schedule. Both alternate Worker URLs are disabled in its configuration. The custom CPU override was removed after Cloudflare rejected it on Free; the actual Free-plan ceiling remains.
- Twenty live checks across apex and www passed: health, homepage, existing model and dataset, agent skill, anonymous MCP initialization, 413 for oversized MCP, 400 for wildcard OAuth registration, and 401 for same-origin unauthenticated assistant/token requests. An earlier missing-Origin test correctly returned 403; the corrected test then checked authentication separately. No traffic-flood test was performed.
- Signed-in Chrome inspection confirmed the homepage, existing branding, Workspace navigation, Upload now and repository/listing sections. Fresh verification was tested locally with a mock provider; no real Clerk code exchange or credential issuance was performed.
- GitHub's open dependency count fell from 277 to one medium Accelerate advisory after the lock updates were indexed. The OSV scan includes that issue in three locks even where GitHub does not report separate alerts.
- Clerk Free remains active by operator choice. Business-mail delivery verification was not completed, so DMARC is unchanged. No paid upgrade or stronger email enforcement is claimed.

The public MCP file listing and a four-byte dataset download through the complete Worker/runtime path also passed (206, `bytes 0-3/1239`). See [structured live evidence](../docs/verification/resource-hardening-live.json).
