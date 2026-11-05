# Sigma News

Sigma lives at `/sigma`, under Community. The footer signup replaces only the former Agent Friendly badge inside the existing intro column. Papers are queried from the existing `app.papers` records and link to their canonical pages. Each news story is a Post with a Sigma editorial record; its original Post URL redirects to the Sigma story. No second copy of a Paper is created.

## Everyday use

1. Open **Write for Sigma** and sign in. Write in English, Russian or Simplified Chinese. Add the other languages in the same draft, primary sources and up to two credited images. Images are resized without cropping, re-encoded and stripped of JPEG metadata.
2. Save privately, then send for review. Authors can edit their own drafts. Authorized editors can review and publish. A later draft does not change the public snapshot until it is published again. Concurrent edits return a conflict instead of overwriting each other. Unpublishing removes the public story and image access; a draft can then be deleted.
3. An administrator can grant or remove editor access by profile handle in the editor desk. Administration uses the existing signed `SUPERII_ADMIN_USER_IDS` setting. An author cannot grant themselves editor access.
4. A reader chooses their normal site language. A missing article translation shows the original language and a clear notice. Newsletter language is saved independently and can be changed through the link in any edition.

Public discovery displays three stories per page. The one-to-two-screen target applies to discovery, not to full-length reading, editing or arbitrarily large accessibility text. The existing footer wraps naturally on phones; Sigma's community navigation becomes a horizontally scrollable row.

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

## Prepared research pack

The offline converter never fetches, edits the source folder, publishes or sends mail:

```sh
node tools/prepare-sigma-pack.mjs SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY
```

It produces one JSON bundle per article, preserving the supplied three language texts and up to two images, plus a manifest. Open `/sigma/editor` → **Import draft** to import a numbered file. Import always clears the rights/source confirmation. The November 4 pack contains harvested third-party prose and requires editorial attribution/original-writing review and image-permission verification. The converter deliberately keeps it out of the public repository and publication migrations.

## Validation

`npm run check`, `npm run build`, `npm run db:check`, and `npm run db:test` cover the existing application and Sigma. The database test adds `tools/check-sigma-flows.mjs`, exercising real routes with signed restricted PostgreSQL contexts and mocked email transport. It covers author isolation, publication snapshots, stale writes, revocation, hidden profiles, confirmation/token expiry, multilingual fallback, edition snapshots, send deduplication and unsubscribe. No test emails are sent externally.

Deploying the Worker, applying production migrations, activating provider credentials and sending an edition are separate operational steps. None is performed by the converter or tests.

### Implementation verification — November 5, 2026

- Production build, release security/secret scans, migration validation, and the complete PostgreSQL regression suite passed. The focused Sigma database suite also passed after the final subscription-link changes. Astro check reported no errors or warnings (eight informational hints).
- Browser checks used isolated, read-only local fixtures, without production Clerk credentials or an email provider. English, Russian and Chinese layouts were checked, including 390px and 320px phone widths, pagination, Papers links, the article reader, editor controls and honest unavailable-provider feedback. Authentication and writes were tested separately through real signed PostgreSQL contexts.
- The mascot's computed animation loops automatically with no control button; the footer placeholder is `you@company.com`. Discovery fits approximately 1.5 desktop screens and two phone screens at the tested default text sizes, with no horizontal page overflow.
- The supplied pack was converted into 15 private import bundles with 29 images and three language versions. The source folder was unchanged, and no harvested article text or research images were added to the repository or published.
