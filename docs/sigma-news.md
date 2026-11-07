# Sigma News

Sigma lives at `/sigma`, under Community. The footer signup replaces only the former Agent Friendly badge inside the existing intro column. Papers are queried from the existing `app.papers` records and link to their canonical pages. Each news story is a Post with a Sigma editorial record; its original Post URL redirects to the Sigma story. No second copy of a Paper is created.

## Everyday use

1. Open **Write for Sigma** and sign in. Write in English, Russian or Simplified Chinese. Add the other languages in the same draft, primary sources and up to two credited images. Images are resized without cropping, re-encoded and stripped of JPEG metadata.
2. Save privately, then send for review. Authors can edit their own drafts. Authorized editors can review and publish. A later draft does not change the public snapshot until it is published again. Concurrent edits return a conflict instead of overwriting each other. Unpublishing removes the public story and image access; a draft can then be deleted.
3. An administrator can grant or remove editor access by profile handle in the editor desk. Administration uses the existing signed `SUPERII_ADMIN_USER_IDS` setting. An author cannot grant themselves editor access.
4. A reader chooses their normal site language. A missing article translation shows the original language and a clear notice. Newsletter language is saved independently and can be changed through the link in any edition.

Public discovery displays three stories per page. The one-to-two-screen target applies to discovery, not to full-length reading, editing or arbitrarily large accessibility text. The existing footer wraps naturally on phones; Sigma's community navigation becomes a horizontally scrollable row.

## Finding and sharing news

The news list combines text search across published translations with a topic selector. It shows the matching result count, the current page and total pages, and direct page links. Filters are kept when changing pages; changing a filter starts from the first page. Out-of-range page requests resolve to the last real page. Papers keep their existing records and separate search results.

Every news item and article has a Share button. It opens the device share sheet where supported, falls back to copying the canonical article URL, and exposes a selectable URL if clipboard access is unavailable. Cancelling native sharing does not copy or send anything.

Signed-in members can add or remove one heart per story. Only the total and the viewer's own state are returned; liker identities are private. Likes do not influence ordering. Writes require a same-origin request, verified member identity, bounded input and an identity rate limit. Migration `0047_sigma_discovery_engagement.sql` adds the RLS-protected like table and narrow gateways; apply it before deploying these discovery controls.

## Motion

The original 👾 mascot animates automatically with a quiet idle bob, a short hop when a previously unseen edition is opened, and a brief thank-you wiggle after a successful action. There is no play/pause control or sound. Offscreen mascots and hidden tabs conserve resources, and the operating system's reduced-motion preference is respected. Browser storage is optional and only remembers whether an edition has been seen.

## Newsletter setup and operation

Apply migration `0046_sigma_news.sql` with the project's normal migration process. The new tables have no direct backend grants; narrow functions enforce author/editor/admin authority and expose public snapshots without draft or subscriber data.

Configure these Worker secrets/settings through the existing secret-management process:

- `RESEND_API_KEY`: a Resend key authorized to send from the chosen verified domain.
- `SIGMA_EMAIL_FROM`: the verified sender, for example `Super ii Sigma <sigma@your-verified-domain>`.
- `SIGMA_TOKEN_SECRET`: at least 32 random characters for confirmation/manage-link HMACs. Keep it stable; rotating it invalidates existing email links.
- `SIGMA_PUBLIC_ORIGIN`: canonical HTTPS origin, normally `https://superii.site`.
- Existing `CONTACT_HASH_SALT`, database context settings, Clerk and `SHOWCASE_MEDIA` binding remain necessary.

No provider key or sender is included in source control. Without mail configuration, subscription requests fail honestly with a temporary-unavailability message. Do not deploy the signup as ready until the verified sender and real confirmation/unsubscribe path have been exercised with an address the operator controls.

Signup sends a confirmation email. GET requests only display the confirmation page; activating a subscription requires the reader's explicit button action, so a mail scanner cannot subscribe them. Confirmation expires after 24 hours. Requests are limited by network and hashed email identity, and repeated/active subscriptions receive the same generic response.

Publishing a story never emails subscribers. Editors select up to 15 published stories and create an immutable edition preview in all three languages. Only administrators can press **Send this edition**. The explicit confirmation starts/resumes batches of three; keep the page open. Closing it stops requesting further batches. The same edition can be resumed from the desk.

Recipients are frozen at send start, and consent is rechecked before each delivery. Each recipient has a stable delivery idempotency key. Ambiguous delivery failures wait two minutes before an idempotent retry and are never automatically retried beyond 23 hours, within Resend's documented 24-hour deduplication window. Permanent failures remain counted for review. Changing a source story later does not change an already prepared email. Newsletter preview counts are estimates until send starts because subscribers may join or leave.

Every newsletter includes subscription preferences and unsubscribe links, including RFC 8058 headers and a bounded one-click POST endpoint. No subscriber list is exposed by a public route. This first version is editor-driven daily publishing; it does not invent a story, schedule an edition, or silently send a catch-up campaign.

Astro's built-in form-origin check runs before application routes and rejects mail providers' origin-free RFC 8058 requests. The first application middleware therefore enforces the equivalent form-origin boundary instead. Its only exception is an exact POST to `/api/sigma/subscription`, with no Origin or Sec-Fetch-Site header, the form URL-encoded content type, exactly one query parameter and a valid manage-token HMAC. Extra action parameters, duplicate tokens, browser cross-site forms and invalid signatures fail closed. The route then bounds the request body and authorizes unsubscribe only. Other form and JSON route protections remain in place.

## Prepared research pack

The offline converter never fetches, edits the source folder, publishes or sends mail:

```sh
node tools/prepare-sigma-pack.mjs SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY
```

It produces one JSON bundle per article, preserving the supplied three language texts and up to two images, plus a manifest. Open `/sigma/editor` → **Import draft** to import a numbered file. Import always clears the rights/source confirmation. The converter keeps source material out of the public repository and publication migrations. An editor remains responsible for source attribution, publication rights and claim accuracy.

On November 6, the owner explicitly authorized releasing the complete November 4 pack. All 15 stories, 45 language versions and 29 images were published through the existing signed, restricted editorial gateway as `@smavgs`. Image metadata was stripped and content hashes checked. Original source folders were unchanged. Source links and image credits remain visible. Publication authorization is recorded in the editorial note; it is not independent verification of every third-party claim or image license.

## Validation

`npm run check`, `npm run build`, `npm run db:check`, and `npm run db:test` cover the existing application and Sigma. The database test adds `tools/check-sigma-flows.mjs`, exercising real routes with signed restricted PostgreSQL contexts and mocked email transport. It covers author isolation, publication snapshots, stale writes, revocation, hidden profiles, confirmation/token expiry, multilingual fallback, edition snapshots, send deduplication and unsubscribe. No test emails are sent externally.

Deploying the Worker, applying production migrations, activating provider credentials and sending an edition are separate operational steps. None is performed by the converter or tests.

### Implementation verification — November 5, 2026

- Production build, release security/secret scans, migration validation, and the complete PostgreSQL regression suite passed. The focused Sigma database suite also passed after the final subscription-link changes. Astro check reported no errors or warnings (eight informational hints).
- Browser checks used isolated, read-only local fixtures, without production Clerk credentials or an email provider. English, Russian and Chinese layouts were checked, including 390px and 320px phone widths, pagination, Papers links, the article reader, editor controls and honest unavailable-provider feedback. Authentication and writes were tested separately through real signed PostgreSQL contexts.
- The mascot's computed animation loops automatically with no control button; the footer placeholder is `you@company.com`. Discovery fits approximately 1.5 desktop screens and two phone screens at the tested default text sizes, with no horizontal page overflow.
- The supplied pack was converted into 15 private import bundles with 29 images and three language versions. The source folder was unchanged, and no harvested article text or research images were added to the repository or published.

### Production verification — November 6, 2026

- PR #154 merged as `8b87dcf694d1de2636c65397cb9e248ffdb18817`. Worker version `72a3ed3c-bdca-4bd3-a04e-e3155bb39b2f` serves both production hosts. All five workflows passed before merge. Migration 0046 was applied alone; its five new tables have RLS and no direct backend table grants.
- Resend verified `news.superii.site`. A controlled signup email from `Super ii Sigma <sigma@news.superii.site>` was delivered, and the recipient's explicit confirmation activated the subscription. No newsletter edition was sent.
- The live check exposed Astro's rejection of origin-free unsubscribe POSTs. The middleware correction was built and tested on Cloudflare version preview `c202d822-af30-43b7-af02-9a6c70d7bdbe`: the signed callback returns 200; ordinary forms, cross-site browser requests, forged tokens and action-dispatch attempts return the application's 403. The callback uses the production test subscriber, not a mocked database.
- Public HTTP checks passed for every one of the 45 localized story pages and all 29 JPEGs, including SHA-256 equality. Both production hosts passed the 40-route machine-access smoke check. Live browser checks covered the article reader and language switching. Discovery measured 1,238px high at a 956×817 viewport and 1,632px at 390×844, without horizontal page overflow; long articles are intentionally separate reading pages.
- The live mascot has an infinite running idle animation and no play control. The footer email placeholder is `you@company.com`. Screenshots and the per-story publication manifest remain in the operator's local release checkpoint; no subscriber token or provider credential is committed.
- `@smavgs` has Sigma editor access. The existing global administrator setting was preserved. Publishing a story and sending an email edition remain separate actions; edition sending still requires an existing administrator.

The version IDs above record the observed release and correction preview, not a claim that deployments can never change. Inspect the latest Worker deployment when operating a later release. `docs/verification/sigma-production.json` records the same verification boundaries without secrets.
