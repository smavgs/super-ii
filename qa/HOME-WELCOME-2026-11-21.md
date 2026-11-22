# Homepage welcome and privacy choices

Status: deployed and verified on both canonical domains. Migration 0052 and PRs [#187](https://github.com/smavgs/super-ii/pull/187) and [#188](https://github.com/smavgs/super-ii/pull/188) are released. The final Worker is `04b04129-5585-48a4-87d9-2fec73f4cc04`, built from source commit `34c9e7aecf7a0335c0032072379c0c4220253764`. The release date is November 21 in the operator's timezone; the final deployment timestamp is November 22 UTC.

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

## Production verification

- All nine required PR checks passed before each implementation merge. Full M1 production builds passed, including release validation and scanning 3,475 output files for private local values.
- The migration owner applied only the reviewed 0052 bytes. Existing profile identities/handles and repository counts were unchanged; allocator ownership and grants were preserved. The application has no direct read/write access to the counter table. A real restricted-service check refused existing/reserved handles and exercised the recorder inside a transaction that was rolled back.
- Thirty-six public HTTP checks passed across `superii.site` and `www.superii.site`: three language homepages, five catalogues, health, real available/taken/reserved handle checks, origin rejection, administrator-report protection, consent absence/decline and refusal of extra event fields. Both domains remained healthy after the CSS-only follow-up.
- A fresh isolated browser used the real production availability endpoint, checked `smavgs` as unavailable and a test name as available, and carried that name into the rendered live Clerk signup. It stopped before creating an account. The invitation stayed at the same position below the header while scrolling, with no page-wide overflow at 390 CSS pixels.
- Live browser observation found zero optional requests while declined and after withdrawal. Allow produced only the expected event/surface/locale payload. That one request was intercepted to avoid retaining a synthetic production counter; the restricted recorder was verified separately with the rolled-back database transaction above.
- English, Russian and Chinese live panels fit mobile widths. The follow-up verified the actual 4 px backdrop blur at 390×844, 1440×900 and 844×390, with no document overflow; reduced-motion emulation disabled the new animations. The initial live inspection found that CSS compression kept only the Safari-prefixed blur declaration. PR #188 separates the Safari fallback into a feature query so standard and older Safari forms survive the production build.
- The final deployment serves 100% of traffic, retains both custom domains and the hourly schedule, and preserves all 29 existing binding names/types. Workers preview URLs and the existing free-plan configuration were unchanged. No runtime service, subscription plan or credential was replaced.

See the compact [production record](../docs/verification/home-welcome-production.json). Local header fixtures remain distinct from a real authenticated iPhone/Safari session, and opening the live signup widget does not verify completing a new registration.

## Rollout and rollback

Migration 0052 was applied before the initial Worker `221d07d5-c7ea-422a-88c3-79dc5ec2da6c`; the final CSS correction is in Worker `04b04129-5585-48a4-87d9-2fec73f4cc04`. The previous pre-welcome Worker `6fadd126-120d-428a-8118-809cfe183ac9` remains the rollback reference. Migration 0052 is additive apart from the compatible profile allocator replacement, preserves existing handles, and is safe to rerun. A Worker rollback stops this new client collector; the bounded private counter table can remain. Do not remove profiles, change existing handles or drop shared account data to roll back this interface. Finite migration launchers and the disposable local test servers were stopped after verification.
