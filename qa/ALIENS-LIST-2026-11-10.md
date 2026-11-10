# Aliens List release verification — 2026-11-10

## Result and scope

Free hardware classifieds and Wanted ads worldwide, plus AI/hardware events initially in San Francisco and Shenzhen. Public reading; free member posting, private listing conversations and saved searches. No checkout, escrow, shipping service, AI price estimates or transaction-reputation claims.

The existing native 👾 emoji is used exactly, as requested. The compact homepage strip follows Skills. Community includes Aliens List, and Workspace has My listings / Messages / Saved searches. Core navigation and form labels use the existing English, Russian and Simplified Chinese localization system; member content stays in its original language.

## Local verification

- `npm run check`: 0 errors, 0 warnings; 16 informational/deprecation hints.
- `npm run db:check`: 50 migrations; 144 tables and one view.
- `npm run db:test`: full PostgreSQL 17 suite passed, including rerunning every migration and 84 Aliens List assertions.
- Real API modules were exercised against disposable PostgreSQL with real generated JPEG uploads, isolated object storage and mocked Resend. Coverage includes anonymous and cross-origin rejection, owner boundaries, photo visibility, coarse location storage, stale edits, publication quotas and draft-renewal bypass rejection, private-message access, UUID replay, composite message-history pagination, bounded member pages, daylight-saving date conversion, closing expiry actions, new accounts without profile rows, blocks, reports, moderator privacy, hide/restore preserving sold state, expiry/renewal, search matching/deduplication, event constraints/duplicate edits, verified-email opt-in, opt-out/re-enable token rotation and digest deduplication.
- The official-event migration was applied twice in disposable PostgreSQL: exactly three records, with an intervening curator edit preserved. Source links and coarse venue locations are in `src/data/aliens/official-events.json`.
- `npm run build`: full validators, Cloudflare bundle, security check and 3,016-file release secret scan passed with the final emoji and copy updates.
- Browser inspection used a credential-free local copy with display-only fixtures. Phone (320 and 390 CSS pixels), desktop (1280 CSS pixels), light/dark form layouts, date-only event controls, city lookup and mobile list/map switching were checked. Chinese and narrow Russian discovery render without horizontal overflow. Populated private-conversation layout was checked using local fixtures; duplicate inbox navigation was removed. The homepage pause button stops the ticker; reduced-motion CSS disables it. The standard 👾 emoji was confirmed, with no custom SVG mascot. The homepage strip is 293 CSS pixels high at 390px; its actions stay stationary.

## Evidence limits

No production fixture, test conversation, test listing or test email was created. First real member listing/conversation completion, physical iOS/Android and mainland WeChat/network behavior are unverified. The three real events are source-linked curator entries; current schedules and admission remain with their organizers. The hourly Worker schedule is deployed; optional digest delivery uses the existing sender configuration but has not been exercised with a real recipient. A configured sender is not proof of new email delivery.

## Release

- [PR #160](https://github.com/smavgs/super-ii/pull/160) merged at `58799a54f2f4c7dc23da26d700cb5e904429a445`. Required PR checks passed. Post-merge Validate and build ([run 42832915682](https://github.com/smavgs/super-ii/actions/runs/42832915682)), CodeQL and Secret scanning all completed successfully.
- Additive migrations 0049–0050 were applied to production: 144 base tables and one view afterward. Counts in all pre-existing tables were unchanged. Exactly three real official-source events were inserted under the existing smavgs curator; no synthetic public content was inserted.
- Worker `07e0b1eb-cf1b-441d-9bca-85a589267790` deployed the merged implementation on `superii.site` and `www.superii.site`, including the hourly `17 * * * *` schedule and existing private object-storage binding.
- All 20 live HTTP checks passed across both domains: public listing/event discovery and exact official event IDs; 401 member access and unauthenticated writes; 403 cross-origin writes; 400 malformed filters; 404 missing listings/photos; no-store headers; and the public system-state endpoint. The first Python HTTP run timed out; the completed curl-based run and browser inspection supplied the successful evidence.
- Live browser inspection verified English and Chinese events, the Shenzhen event's date range and organizer link, the native 👾, desktop list/map, the 390px mobile layout and map switch, the compact homepage strip after Skills and its pause/play control. Posting and My listings redirect signed-out visitors to sign-in with the intended destination. The checked mobile pages have no horizontal overflow.
- The local release evidence folder `superii-aliens-list-2026-11-10` contains migration counts, the deployment log, all 20 HTTP results and desktop/mobile screenshots. Production browser checks were read-only; member mutation behavior was verified with disposable local data.
- Release follow-up corrects the evidence register and limits item-inspection/payment copy to hardware details, where it applies.
