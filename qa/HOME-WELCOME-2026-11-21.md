# Homepage welcome and privacy choices

Status: implemented and locally verified; production rollout pending migration 0052 and the Worker release.

## User experience

- The existing homepage, yellow hero, chat launcher and Human/Machine switch stay in place. A narrow neon-orange invitation floats below the sticky header for signed-out visitors. On phones it expands from a compact handle invitation; availability errors are recoverable without losing input.
- Names use the current personal-profile namespace and its 30-character requested-name limit. The check does not reserve a name. Clerk signup carries a validated handle preference in unsafe metadata, which never confers authority. Allocation uses the existing authenticated profile function and its database unique indexes. Existing handles never change. A collision gets the existing deterministic suffix behavior, with the actual resulting handle shown on the signup return to Workspace.
- A white panel enters from the right with the existing alien emoji offering a cookie. Its native modal backdrop blurs and makes the rest of the page inert. Both labeled choices have the same size. Escape declines. Footer Cookie choices reopens it; without JavaScript the link opens the policy and optional measurement remains off.
- English, Russian and Simplified Chinese are supplied directly. The Russian header uses the concise label “Кабинет” so the complete label fits alongside the bell, theme and menu controls.

Visual direction: existing yellow, black and pixel details, one orange signup accent and a white privacy panel. Content stays in its existing sections. Motion is limited to the floating invitation, empty-field placeholder cycle, side entrance and alien/cookie gesture. Reduced motion disables the new animations; typing is never animated or replaced.

## Measurement and access

The versioned preference cookie lasts 180 days. The browser sends no optional events before Allow and has no backlog to replay. Every request rechecks consent, and the endpoint checks it again before reading the body or touching the database. Cross-tab changes close an open choice panel; each tab reads the cookie before sending.

Only allowlisted event/surface/language values reach daily aggregate counters. No visitor ID, account ID, raw network address, typed handle, private message, filename, full URL or error text is stored in that table. Public section opens, signup/Workspace opens, handle interactions and download clicks are counts of actions, not unique people, completed downloads or verified completed registrations. Private chat and nested Workspace routes are excluded. Existing infrastructure/security processing and Cloudflare's separate cookieless performance measurement remain disclosed; this panel does not claim to disable every existing operational counter.

Migration 0052 adds a boolean availability function, hardens profile allocation against private-name and simultaneous-signup conflicts, and creates the private aggregate table and narrowly granted functions. New endpoints require same-origin bounded JSON and existing rate limits. The report at `/api/experience/report` requires the configured platform administrator and a verified admin database context. The application has no direct access to the counter table. Records beyond the rolling 90 UTC days are removed on recording and by the existing hourly maintenance schedule.

## Verification

- `npm run check`: no errors or warnings; existing hints remain.
- `node tools/check-welcome.mjs`: handle normalization/reserved names, metadata-to-allocation handoff, authenticated identity boundary, consent defaults and withdrawal, payload allowlists, private-route exclusion, rate-limit and origin failures passed.
- `npm run build`: full validation, release build and built-security/secret checks passed on the M1.
- `npm run db:test`: complete PostgreSQL 17 integration suite passed, including rerunning all 52 migrations and the new restricted-role smoke test.
- Additional disposable PostgreSQL 16 run: eight concurrent users requested the same name, all succeeded with eight unique handles and exactly one unsuffixed name. Eight simultaneous requests by one authenticated identity also succeeded. Existing interaction smoke tests passed.
- Local browser at 320, 375, 390 and 844 CSS pixels: signed-in header markup fixtures kept all three language labels on one line, with a notification control and no document overflow. This is layout verification, not a real iPhone Safari session or a live authenticated login.
- Local browser at 390×844 and 844×390: all translated dialogs fit after entrance, expanded details scroll inside the panel, backdrop blur is present, Escape works, and the invitation stays below the header while scrolling. Reduced-motion emulation reports no new panel/mascot animation.
- Browser availability-response fixtures cover taken names, rate limits, success and preservation through the signup URL. Consent payload inspection shows only event/surface/language, zero calls while declined, and no calls after withdrawing consent. Those fixtures simulate endpoint responses; real database authorization is verified separately above.

Real new-account OAuth/email completion and a physical iPhone session have not been exercised. No production test account, email, repository or public resource was created.

## Rollout and rollback

Apply migration 0052 with the migration-owner credential before deploying the Worker. It is additive apart from the compatible profile allocator replacement, preserves existing handles, and is safe to rerun. Keep the previous Worker version available for rollback. A Worker rollback stops this new client collector; the bounded private counter table can remain. Do not remove profiles, change existing handles or drop shared account data to roll back this interface.
