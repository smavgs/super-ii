# Robots product experience — 29 October 2026

## Scope

The update brings the model/Workspace visual system to robot detail, product/company claims and private company inquiries. It imports the three user-supplied photo folders, adds public likes and daily-deduplicated opens, and adds worldwide company-country selection. It preserves source specifications, original logos, authority verification, private drafts and the three-active-upload allowance.

## Verification

- 787 reviewed product images: 198 robot, 73 hand and 516 component representatives. Every mapped file and SHA256 delivery hash was checked. Originals total 265,807,086 bytes; proportional WebP previews total 24,303,848 bytes, with the largest 437,884 bytes. No extra generated files remain. Embedded photograph backgrounds are preserved; media frames and logo tiles are white.
- All 43 migrations were applied twice to disposable PostgreSQL 17. The full integration suite passed, including the existing 53 Robots checks and 64 new HTTP/database checks for scoped ownership, authorization, private contacts/inquiries, deduplicated likes/views, retries, team revocation, country validation and retained product URLs.
- Contact-only publication was checked against an unrelated private company draft edit; that edit stayed private. An existing whole-company claim cannot silently grant company administration through a product-labelled access request.
- Type/template checks: zero errors and warnings, three existing hints. Site/content/localization validation and the Cloudflare production build passed. Release-bundle checks found no private local values. Rust formatting/build/tests/Clippy, 142 runtime tests, 45 SDK tests (five optional skips), package builds, container builds and Compose validation also passed.
- In the isolated local browser, a product claim moved from pending to confirmed using a disposable website-proof fixture. Contact publication enabled the product's private inquiry form. A consented inquiry returned its success receipt and email continuation. No email was sent.
- The Russian company inbox displayed the consented local inquiry, hid pagination for one item and saved its replied status. Its new-inquiry count changed from one to zero.
- Desktop (1440), phone (390) and narrow Chinese (320) detail layouts were inspected. The phone dialog and document widths matched the viewport without horizontal overflow. Escape closed the dialog. Product photos loaded from local assets; fixed same-origin paths also avoid cross-host image blocking on the two production domains.
- Local category searches returned all 198 robots, 73 hands and 516 grouped components in approximately 176–181 ms per restricted database round trip, including Docker/psql startup. This is local evidence, not a production latency promise.

Screenshots, photo mapping manifests and command logs are stored in the task's local release evidence directory. Only disposable local data was created for claim/inquiry/engagement tests.

The first pull-request audit identified GHSA-rmxm-3fg6-px4f in the existing transitive `@hono/node-server` dependency. Its lockfile entry was updated from 2.1.1 to patched 2.1.5; the production npm audit and rebuilt release passed with zero reported npm vulnerabilities. This does not claim that every dependency ecosystem has no outstanding advisories.

## Production release — 30 October

The feature rollout was verified on Worker `50f31942-a06f-468b-a02b-1f1eb6f79c0a` on both canonical domains. Subsequent release-status translation changes retain the same application behavior. Migrations 0042/0043 were applied before deployment; 0041 switched the 787 reference covers after the assets were live. The previous rollback Worker is `a2e11f57-a90f-490c-b092-cd1735935927`.

Thirty-eight live checks passed across both domains: catalogue totals, product detail, English/Russian/Chinese pages, machine documentation/schema, unauthenticated write/inbox refusal, cross-origin refusal and image response policy. All 787 downloaded WebP hashes matched the reviewed delivery inventory. The first pass caught duplicate resource-policy headers; the media rule now detaches the inherited header before setting `cross-origin`. The corrected rule was checked in the local Cloudflare runtime and on both live hosts. Its deployment changed no image bytes.

Production retains RLS on all 129 application tables, with no direct application-role grants on the five new private tables. Existing profiles, repositories/files, company records and claim records retained their counts; reference facts retained their hash. Ordinary usage counters continued to change. No production claim, inquiry or like fixture was created; the normal browser product visit recorded one deduplicated view.

Signed-in browser checks opened both the product and full-company claim forms and verified their distinct scope text. Chinese mobile detail matched the 390 px viewport without horizontal overflow. The live catalogue and product view screenshots are in the local release evidence directory. First actual manufacturer authorization and inquiry completion remain unverified.

The application commit passed all GitHub workflows before deployment. The final header/evidence update and post-merge status are tracked in [PR #143](https://github.com/smavgs/super-ii/pull/143). The bounded, credential-free [release record](../docs/verification/robots-experience-production.json) records the deployed state.

## Practical limits

- Product views are daily network-deduplicated opens, not unique people, purchases or evidence of demand. Individual inquiry and like identities stay private.
- Inquiries are stored in the company inbox. Mail links use the sender's or company's mail app; Super ii does not deliver or verify those emails. Archiving an inquiry does not delete it.
- A first real manufacturer claim and inquiry, fresh member uploads, mainland/WeChat completion and physical hardware execution remain unverified.
- No South Korean manufacturer was positively identified in the supplied company entries. No origin flags were changed on a guess. The Korea test fixture proves the global selection/filtering path only.
