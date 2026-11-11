# Aliens List

Approved product: free worldwide used/refurbished/open-box hardware and Wanted ads; AI/hardware events initially San Francisco and Shenzhen. Public browsing, free member posting and private member conversations. No checkout, escrow or shipping service. Community navigation; Workspace gets three shortcuts.

Visual thesis: Super ii's warm yellow and navy frame, the same native 👾 emoji used across Super ii, compact working controls, and a readable list beside an approximate-location map.
Content plan: short identity and two tabs; search and city/radius; useful listings or honest empty state; concise listing detail and contact; small homepage strip after Skills.
Interaction thesis: the familiar 👾 emoji, a continuously moving topic strip with reduced-motion support, crisp button feedback; stationary actions and keyboard-equivalent map controls.

The homepage ticker runs automatically with two identical text groups. Each group repeats enough phrases to exceed the visible width; resizing and font changes recalculate the coverage. The track moves by exactly one group at a constant 20 pixels per second, so the next cycle joins without a blank tail. There is no play/pause button; the device's reduced-motion preference is still respected.

## Delivery checklist

- [x] Listings, photos, renewal/expiry, ownership and moderation
- [x] Private listing-linked messages, block/report, bell notifications
- [x] Saved searches, match alerts, expiry reminders, optional email
- [x] Global city search and approximate map with adjustable radius
- [x] Hardware and events browse, details, drafts and posting
- [x] Member tools and moderator queue
- [x] Homepage, Community and Workspace integration
- [x] Isolation and behavioral tests; mobile/desktop browser verification
- [x] Migration, PR checks, merge, deployment and live access verification — see [release evidence](../../qa/ALIENS-LIST-2026-11-10.md)

## Boundaries

Precise pickup coordinates are never stored. Server rounds public coordinates to a 0.02-degree grid. Photos are decoded/re-encoded in the browser and metadata stripped again on the server. Messages are accessible only to participants; moderators see only reported messages. New-account quotas, idempotent mutations, same-origin writes and rate limits apply. Two different original photos are required for sale ads, with the owner's confirmation; this is not verification of condition or ownership.

Ordinary legitimate ads publish immediately. Hardware expires after 30 days with free renewal; events leave upcoming results after their end. Saved-search alerts and renewal reminders use the member bell. Optional email is off by default and limited to a digest linking to private member tools; message contents are never emailed.

AI-assisted descriptions, price estimates and transaction reputation remain later ideas, not promises in this release. Physical mobile/WeChat verification remains outside the available desktop browser evidence.

## Sources and operations

Maps use Leaflet 1.9.4 and standard OpenStreetMap raster tiles, with visible attribution and normal browser cache/referrer behavior. No tile prefetch or offline downloads. `ALIENS_MAP_TILES` can change the tile provider on all listing surfaces without code changes. The GeoNames cities15000 extract is served locally, avoiding third-party keystroke/address requests; it includes 34,208 cities. Smaller places can be entered manually with an approximate pin. Data license and update script are checked in.

`src/data/aliens/official-events.json` records three organizer-sourced events checked on 2026-11-09. Migration 0050 inserts these under the existing smavgs curator only, with stable IDs and no overwrite on rerun. Date-only events use an exclusive end date for automatic expiry and do not invent daily opening hours. Source pages: AI Engineer Code Summit 2026; AI Engineer World's Fair 2027; CHTF first-time visitor guidance. Official registration always remains with the organizer.

The Cloudflare entrypoint preserves Astro's fetch handler and adds an hourly scheduled task. It creates deduplicated expiry reminders and delivers optional daily digests. Existing Resend/Sigma sender credentials are reused with a separate Aliens List token purpose; `ALIENS_EMAIL_FROM` can override the display sender. Email is off by default, requires the verified primary Clerk email, has a signed unsubscribe page, uses provider idempotency keys, and excludes private message content. Failed deliveries retry with the same key for less than 24 hours, then advance to the next digest window.
