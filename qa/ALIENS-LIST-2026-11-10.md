# Aliens List release verification — 2026-11-10

## Result and scope

Free hardware classifieds and Wanted ads worldwide, plus AI/hardware events initially in San Francisco and Shenzhen. Public reading; free member posting, private listing conversations and saved searches. No checkout, escrow, shipping service, AI price estimates or transaction-reputation claims.

The existing native 👾 emoji is used exactly, as requested. The compact homepage strip follows Skills. Community includes Aliens List, and Workspace has My listings / Messages / Saved searches. Core navigation and form labels use the existing English, Russian and Simplified Chinese localization system; member content stays in its original language.

## Local verification

- `npm run check`: 0 errors, 0 warnings; 16 existing hints.
- `npm run db:check`: 50 migrations; 144 tables and one view.
- `npm run db:test`: full PostgreSQL 17 suite passed, including rerunning every migration and 80 Aliens List assertions.
- Real API modules were exercised against disposable PostgreSQL with real generated JPEG uploads, isolated object storage and mocked Resend. Coverage includes anonymous and cross-origin rejection, owner boundaries, photo visibility, coarse location storage, stale edits, publication quotas and draft-renewal bypass rejection, private-message access, UUID replay, composite message-history pagination, bounded member pages, new accounts without profile rows, blocks, reports, moderator privacy, hide/restore preserving sold state, expiry/renewal, search matching/deduplication, event constraints/duplicate edits, verified-email opt-in, opt-out/re-enable token rotation and digest deduplication.
- The official-event migration was applied twice in disposable PostgreSQL: exactly three records, with an intervening curator edit preserved. Source links and coarse venue locations are in `src/data/aliens/official-events.json`.
- `npm run build`: full validators, Cloudflare bundle, security check and 3,016-file release secret scan passed with the final emoji and copy updates.
- Browser inspection used a credential-free local copy with display-only fixtures. Phone (390 CSS pixels), desktop (1280 CSS pixels), light/dark form layouts, date-only event controls, city lookup and mobile list/map switching were checked. Chinese discovery renders without horizontal overflow. The homepage pause button stops the ticker; reduced-motion CSS disables it. The standard 👾 emoji was confirmed, with no custom SVG mascot. The homepage strip is 293 CSS pixels high at 390px; its actions stay stationary.

## Evidence limits

No production fixture, test conversation, test listing or test email was created. Physical iOS/Android and mainland WeChat/network behavior are unverified. The three real events are source-linked curator entries; current schedules and admission remain with their organizers. Optional email configuration and the scheduled Worker are checked separately at release; a configured sender is not proof of new email delivery.

## Release

Pending PR checks, merge, additive production migrations, Worker deployment and read-only live access checks. Update this section with observed results only.
