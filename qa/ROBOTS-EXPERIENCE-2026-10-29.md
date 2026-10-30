# Robots product experience — 29 October 2026

## Scope

The update brings the model/Workspace visual system to robot detail, product/company claims and private company inquiries. It imports the three user-supplied photo folders, adds public likes and daily-deduplicated opens, and adds worldwide company-country selection. It preserves source specifications, original logos, authority verification, private drafts and the three-active-upload allowance.

## Verification

- 787 reviewed product images: 198 robot, 73 hand and 516 component representatives. Every mapped file and SHA256 delivery hash was checked. Originals total 265,807,086 bytes; proportional WebP previews total 24,303,848 bytes, with the largest 437,884 bytes. No extra generated files remain. Embedded photograph backgrounds are preserved; media frames and logo tiles are white.
- All 43 migrations were applied twice to disposable PostgreSQL 17. The full integration suite passed, including the existing 53 Robots checks and 64 new HTTP/database checks for scoped ownership, authorization, private contacts/inquiries, deduplicated likes/views, retries, team revocation, country validation and retained product URLs.
- Contact-only publication was checked against an unrelated private company draft edit; that edit stayed private. An existing whole-company claim cannot silently grant company administration through a product-labelled access request.
- Type/template checks: zero errors and warnings, three existing hints. Site/content/localization validation and the Cloudflare production build passed. Release-bundle checks found no private local values. Rust formatting/build/tests/Clippy, 142 runtime tests, 45 SDK tests (five optional skips), package builds, container builds and Compose validation also passed.
- In the isolated local browser, a product claim moved from pending to confirmed using a disposable website-proof fixture. Contact publication enabled the product's private inquiry form. A consented inquiry returned its success receipt and email continuation. No email was sent.
- Desktop (1440), phone (390) and narrow Chinese (320) detail layouts were inspected. The phone dialog and document widths matched the viewport without horizontal overflow. Escape closed the dialog. Product photos loaded from local assets; fixed same-origin paths also avoid cross-host image blocking on the two production domains.
- Local category searches returned all 198 robots, 73 hands and 516 grouped components in approximately 176–181 ms per restricted database round trip, including Docker/psql startup. This is local evidence, not a production latency promise.

Screenshots, photo mapping manifests and command logs are stored in the task's local release evidence directory. Only disposable local data was created for claim/inquiry/engagement tests.

## Release boundary

At preparation, these changes are locally verified and not yet promoted to production. The previous Robots deployment is Worker `a2e11f57-a90f-490c-b092-cd1735935927`. Release completion requires final GitHub checks, migrations 0041–0043, the Worker deployment and read-only live verification. The release ledger will record that result separately.

## Practical limits

- Product views are daily network-deduplicated opens, not unique people, purchases or evidence of demand. Individual inquiry and like identities stay private.
- Inquiries are stored in the company inbox. Mail links use the sender's or company's mail app; Super ii does not deliver or verify those emails. Archiving an inquiry does not delete it.
- A first real manufacturer claim and inquiry, fresh member uploads, mainland/WeChat completion and physical hardware execution remain unverified.
- No South Korean manufacturer was positively identified in the supplied company entries. No origin flags were changed on a guess. The Korea test fixture proves the global selection/filtering path only.
