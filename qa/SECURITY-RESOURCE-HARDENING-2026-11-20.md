# Security resource hardening verification

Status: locally tested release candidate. Live configuration changes are listed separately; production code deployment is not claimed here.

- Full PostgreSQL 17 migration/integration suite passed, including repeated migrations, isolated grant/denial, OAuth quota and wildcard checks, and stale authentication followed by fresh connection approval.
- Astro check, site validation and release build passed. Built secret/static HTML checks passed.
- Python runtime: 143 tests passed. SDK: 45 passed, five explicitly skipped. Publication-service checks and Docker image/config validation passed.
- Rust transfer tests cover bounded concurrency, owner/global reservation limits, restart recovery, second-writer refusal, low disk, slow/oversized/disconnected/cancelled uploads, crash tails, checksums, resume, promotion, expiry and stalled downloads with Range support. A date-format regression test retains old RFC3339 strings, offsets and nanoseconds.
- The strict RustSec audit identified RUSTSEC-2026-0543. Replacing chrono with time removes the affected dependency; required denied-warning checks remain enabled.
- Worker dry-run accepted both rate limiter bindings and the 10-second CPU ceiling. Production secret-name inspection confirmed CONTACT_HASH_SALT and OPENROUTER_API_KEY exist, without printing their values.
- Chrome local fixture: cancel and Escape cause no grant; wrong code remains rejected; success performs exactly one retry; original work selection remains. At 390 px the dialog fits the viewport, focus returns to the invoking button, and no page-wide overflow occurs. This fixture mocks Clerk and is not a real production code/grant exercise.
- Existing live runtime inspection found 41 available transfer records and zero pending bytes. No production fixture uploads or new credentials were created.

## Account-side changes verified in the dashboard

- OpenRouter existing `superii` key: US$50 monthly credit limit. This is not a platform-wide bill cap.
- Clerk production: block disposable emails enabled; user enumeration prevention set to Strict. Existing bot-signup protection and account lockout remain enabled.
- Clerk production MFA/passkeys remain unavailable on Hobby. Pro monthly pricing was inspected; no subscription was purchased.
- Clerk and Private Email DKIM DNS records exist. An older Clerk email passed alignment, but complete current sender validation and stronger DMARC enforcement remain pending.

No production stress test, independent penetration certification, full provider-email exercise or hostile compute isolation is claimed. Keep the canonical capability register conservative until release evidence is recorded.
