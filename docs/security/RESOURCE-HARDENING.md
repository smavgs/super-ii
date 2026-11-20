# Request, transfer and sensitive-action hardening

Prepared 2026-11-20. Deployment is a separate operation from merging this code.

## Admission and cost boundaries

The Worker checks host, URI length, network admission and selected protocol bodies before Astro, Clerk or PostgreSQL. The two canonical domains share a salted network key. Changing user agent or protocol does not reset it. Missing production bindings or a failed limiter returns 503. Localhost development is exempt from network admission.

| Boundary | Limit | Refusal |
| --- | --- | --- |
| Worker requests per network, Cloudflare location | 600/minute | 429; Retry-After 60 |
| Worker writes per network, Cloudflare location | 240/minute | 429; Retry-After 60 |
| MCP actual body | 1 MiB | 413 |
| A2A actual body | 64 KiB | 413 |
| OAuth actual body | 16 KiB | 413 |
| Assistant actual body | 96,000 bytes, then existing character limit | 413 |
| Protocol body read | 30 seconds total | 408 |
| Worker CPU per invocation | 10 seconds | Cloudflare enforcement |
| OAuth registrations, all callers and aliases | 600/hour, durable PostgreSQL counter | 503; Retry-After 3600 |
| Assistant provider calls, including search follow-up | 120/hour, durable PostgreSQL counter | 503; Retry-After 3600 |

Existing endpoint/account quotas remain in force. Binary transfers retain streaming. Cloudflare's rate-limit counters are approximate and local to a location; they are not a global billing cap. The default workers.dev and preview URLs are disabled to close an alternate entry point. Canonical API routes do not require browser challenges.

The operator set the existing OpenRouter `superii` key to **US$50, resetting monthly** on 2026-11-20. This is an account-side credit limit, not a repository setting. It does not cap Cloudflare, Neon, storage, other keys, BYOK, subscriptions or transfer traffic. A whole-platform US$50 ceiling has not been established. Provider rejection pauses assistant processing with an explicit capacity message; it does not disable repository work.

## Rust transfer admission

The local Rust daemon owns its storage root exclusively using an OS file lock. It rebuilds reservations from persisted records after restart. Limits are configurable through `superii-transferd --help` and are explicitly supplied by the macOS launch script and Compose definition:

| Resource | Default |
| --- | --- |
| In-flight admitted requests | 64 |
| Concurrent upload chunks / download streams / disk jobs | 8 / 16 / 2 |
| Unfinished transfers, global / per owner | 128 / 16 |
| Declared unfinished upload capacity | 50 GiB |
| Free disk reserve | 5 GiB, plus scratch and remaining reservations |
| Maximum individual file / chunk | Existing 10 GiB / 32 MiB |
| Idle upload or backpressured download | 60 seconds |
| Total chunk upload / download | 15 minutes / 6 hours |

Busy or full capacity returns 503 with Retry-After 30. Clients resume from the confirmed offset. A disconnected, oversized, malformed, checksum-failed or cancelled upload never advances the acknowledged offset. Pending chunks are removed on failure/cancellation and startup; a crash tail is truncated to the durable offset before retry. Hashing/promotion retains its permit and lock until the blocking job actually finishes, including after the HTTP client leaves. Downloads use bounded 64 KiB chunks and stop when a consumer remains stalled.

Expired cleanup skips active writers. Completed/rejected transfer metadata can be removed seven days after expiry; published content-addressed objects remain. Quarantine reservations do not cap the permanent published object store. Actual free-space checks protect new writes when other disk users consume space, but cannot reserve physical disk against unrelated processes.

Compose additionally sets the transfer container to 512 MiB, two CPUs and 128 processes. The production macOS LaunchAgent does **not** inherit Docker resource isolation. These controls do not establish hostile multi-tenant execution isolation or a throughput guarantee.

## Sensitive access grants

Issuing Work tokens, commerce delegations, Social pairing codes, trusted publishers, or approving an agent connection requires a first factor verified within ten minutes, checked using Clerk's signed session. Revocation and denial remain available without this extra check. Existing scoped machine credentials continue to use their current contracts.

The browser preserves the submitted selections, requests an email code through the documented Clerk session APIs, refreshes the session token, and retries only a rejected action, once. Cancelling grants nothing. This is fresh first-factor verification, **not MFA**. The current Clerk application requires a verified email and supports email codes; changing those settings requires extending or rechecking this flow. A future MFA policy must not silently downgrade to email-only verification.

Clerk production account settings were saved with disposable-email blocking and Strict enumeration protection. Email aliases remain usable. MFA and passkeys require a paid plan and were not enabled by this code change; subscription approval is separate.

## Redirects and mail

OAuth registration rejects wildcard and encoded authorities in both the Worker and PostgreSQL. Literal HTTPS and HTTP loopback callbacks, exact redirect matching and PKCE remain supported. Registering a callback on the Super ii origin does not itself authorize code interception; this release does not invent a blanket ban on otherwise valid literal callbacks.

The supplied report's claim that DKIM is absent was contradicted by live DNS: Private Email and Clerk DKIM records exist. A September Clerk email also passed DKIM, SPF and DMARC in Gmail. This older message does not establish current alignment for every sender. DMARC remains monitoring-only (`p=none`) until Private Email and Resend/Sigma delivery alignment is verified. Do not enforce rejection based only on Clerk's successful test, and do not treat public protocol metadata as a private-data leak.

## Release and rollback

1. Pass the frontend, database, Python, Rust, dependency and browser checks described in the verification record.
2. Save the current OAuth registration function definition; apply only migration 0051 using the migration-owner Keychain credential. No table, client, member or scope migration is required.
3. Confirm there are no in-flight uploads. Back up and atomically replace the installed transfer binary, launch script and Python transfer response-header module. Restart the relevant LaunchAgents and confirm health, configured limits and access boundaries. Verify retained object bytes by a small authenticated Range request.
4. Build and deploy the exact reviewed Worker with both limiter bindings, the existing CONTACT_HASH_SALT and the canonical domains. Verify the public and authenticated boundaries on both hosts without a production load test or synthetic publication.
5. Record the merged SHA, Worker version and runtime binary hash. An application rollback can retain the stricter additive database function. Restore the previous runtime binary/script if necessary and restart; RFC3339 state remains readable by both versions. Restore the function only if a confirmed regression requires it.

The Rust date dependency was changed from the unmaintained `chrono` crate to `time`, retaining RFC3339 JSON timestamps. RustSec remains a required check with denied warnings; no advisory was ignored.
