# Super ii Cards architecture

Super ii Cards are purpose-specific, reusable contact cards created in the signed-in Workspace. They connect people without turning a member's complete contact vault into a public profile or directory.

## Product boundary

- Workspace entry: `https://superii.site/account#cards`
- Presets: six member-facing Cards—Super ii, Business, Personal, Conference, Investor, and Open Source. `custom` remains an internal validated fallback, not a seventh preset or quota slot.
- Languages: English and optional Simplified Chinese identity content plus a complete English/Simplified Chinese public Card interface.
- Contact choices: email, phone, website, WeChat, WhatsApp, Telegram, LinkedIn, GitHub, Hugging Face, QQ, RED/Xiaohongshu, Weibo, and up to five HTTPS custom links.
- Photo privacy: members can choose a local image or take a phone photo. The browser center-crops and re-encodes it as a bounded JPEG, and the server removes JPEG metadata before application-layer encryption. A public image route resolves the portrait only when an active Card snapshot selects it. The public page rewrites a Super ii-hosted portrait to a relative same-origin route so `www.superii.site` and `superii.site` cannot disagree with the strict cross-origin resource policy. Clerk-served profile images remain supported, while arbitrary third-party tracking-pixel URLs remain rejected.
- Sharing: one 256-bit random unlisted token per card, a standards-based QR code, vCard 4.0 download, and one primary native Share action. Browsers without native sharing copy the Card link as that action's fallback; there is no duplicate copy-link control.
- WeChat: the public WeChat action copies the member's WeChat ID and opens the installed WeChat application with `weixin://`. Super ii does not claim a direct per-user chat URL because WeChat does not provide a documented public scheme for arbitrary account IDs.
- Recipient choice: optional private “Share mine back” form.
- Owner controls: draft, publish, pause, resume, rotate link, edit, and delete.

An unlisted card is not an authenticated or secret page. Its token provides unlisted bearer-like access. Anyone who receives its link can view, save, copy, or forward the selected public snapshot. Pages and machine representations request no indexing, use no-store caching, and send a no-referrer policy, but those controls cannot retrieve copies a recipient already saved.

## Data separation

Five PostgreSQL tables keep responsibilities separate:

1. `card_contact_vaults` stores one reusable encrypted contact source per profile.
2. `cards` stores private card configuration, lifecycle state, the one-way token hash, and the encrypted raw token.
3. `card_public_snapshots` stores only the fields selected at the last publication.
4. `card_connections` stores encrypted contact details voluntarily shared back plus encrypted owner notes.
5. `card_photos` stores small metadata-stripped JPEG portraits encrypted before database storage and deduplicated per owner by SHA-256.

The reusable vault is never read through a public route. Publishing creates a bounded snapshot from the selected fields and current badge eligibility. Later vault edits do not silently rewrite an existing public card; the owner publishes again to create the next snapshot revision.

Every private table has row-level security. Composite foreign keys bind a snapshot or connection to the same owner as its card. A signed-in profile can manage only its own rows. Public card reads, public Card-photo reads and recipient share-back use three reviewed security-definer database functions rather than direct table grants. The photo resolver returns encrypted bytes only while an active public snapshot contains that exact Super ii-hosted portrait URL; decryption remains in the Worker.

## Encryption and token handling

The application uses AES-256-GCM with a unique 96-bit IV and context-specific authenticated additional data for:

- reusable contact-vault content;
- raw unlisted card tokens retained for the owner;
- received share-back contact payloads; and
- private connection context and meeting notes; and
- metadata-stripped Card portrait bytes.

The 32-byte encryption key is a deployment secret and is not stored in Git. Public lookup stores and compares only SHA-256 of a syntactically valid 32-byte token. Rotation creates an unrelated token and immediately makes the prior link unresolved. Pause and delete also fail closed.

The public snapshot is intentionally not encrypted from a recipient. It contains only fields the owner chose to publish. Sensitive data must not be placed in a card field merely because the URL is unlisted.

## Badge integrity

Verified card badges are derived at publication time from current Super ii records. A client cannot grant itself a verified badge by sending its name in card configuration. Current sources include Founding 200, finalized Community Leader awards, published repositories, agent work, Robot work, Transparent contribution, and public open-source work.

Personal badges are self-described, visually separate, and never labeled as Super ii verification.

## Recipient share-back

Share-back is optional per card. The recipient supplies a name plus an email address or phone number, with an optional message. The same-origin browser route enforces bounded JSON, validation, a daily request limit, active-card resolution, and current share-back permission. It encrypts the accepted payload before insertion. The data is visible only to the card owner and is never placed in a public directory.

An owner may add encrypted private context and meeting notes or delete the connection. The first release does not send unsolicited messages, sync an external address book, infer relationships, or expose received contacts to agents.

## Representations

For an active card at `/c/{token}`:

- `/c/{token}` is the responsive human card.
- `/c/{token}/card.json` is the versioned selected snapshot.
- `/c/{token}/contact.vcf` is a vCard 4.0 download; `?language=zh-CN` selects available Chinese identity text.
- `/c/{token}/qr.svg` is a high-error-correction SVG QR code for the canonical card link.
- `/schemas/card/v1.json` is the public JSON Schema.

All representations resolve from the same active snapshot. A paused, deleted, unknown, or rotated token returns the same unavailable boundary and does not reveal which condition applies.

## Limits and abuse controls

- At most six cards per member, enforced in the Workspace, owner API, and a serialized database insert trigger.
- At most 48 deduplicated Card portraits per member, with each processed JPEG limited to 240,000 bytes and verified between 64 and 2,048 pixels per side.
- At most 100 recent received connections returned to the Workspace.
- At most five custom HTTPS links.
- Create, update, rotate, and share-back actions have separate server-side rate limits.
- Mutation requests require the canonical browser origin; authenticated owner routes also require the current Clerk profile.
- Inputs use explicit enums, length bounds, request-size bounds, safe URL rules, and generic failure responses.
- QR output encodes the real URL without a decorative center logo that could reduce scan reliability.

The capability register remains the source of truth for deployment status. Passing local checks does not by itself make Cards a production capability.
