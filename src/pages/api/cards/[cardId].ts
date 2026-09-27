import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { decryptCardValue } from '@/lib/card-crypto';
import { eligibleCardBadges } from '@/lib/card-data';
import {
  buildPublicCardSnapshot, parseCardConfig, parseCardCreate,
  type CardConfig, type CardPreset, type CardVault,
} from '@/lib/cards';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { 'cache-control': 'private, no-store' };

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const cardId = params.cardId ?? '';
  if (!uuidPattern.test(cardId)) return Response.json({ error: 'Card not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Cards are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rate = await consumeRateLimit(locals, request, sql, 'cards.update', 120, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Card update limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
    const body = await readBoundedJsonObject(request, 16_384);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers });
    const action = typeof body.value.action === 'string' ? body.value.action : 'save';
    if (!['save', 'publish', 'pause', 'resume'].includes(action)) return Response.json({ error: 'Unsupported card action' }, { status: 422, headers });
    const cardRows = await sql`
      select id, name, preset, status, config
      from app.cards
      where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid
      limit 1
    `;
    const card = cardRows[0] as { id: string; name: string; preset: CardPreset; status: string; config: CardConfig } | undefined;
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404, headers });
    if (action === 'pause') {
      const rows = await sql`update app.cards set status = 'paused', updated_at = now() where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid returning status, updated_at`;
      return Response.json({ ok: true, card: rows[0] }, { headers });
    }
    if (action === 'resume') {
      const rows = await sql`
        update app.cards card set status = 'active', updated_at = now()
        where card.id = ${cardId}::uuid and card.owner_profile_id = ${profile.profileId}::uuid
          and exists (select 1 from app.card_public_snapshots snapshot where snapshot.card_id = card.id)
        returning status, updated_at
      `;
      if (!rows.length) return Response.json({ error: 'Publish this card before making it live' }, { status: 409, headers });
      return Response.json({ ok: true, card: rows[0] }, { headers });
    }
    const nameResult = parseCardCreate({ name: body.value.name ?? card.name, preset: card.preset });
    if (!nameResult.ok) return Response.json({ error: nameResult.error }, { status: 422, headers });
    const configResult = parseCardConfig(body.value.config ?? card.config);
    if (!configResult.ok) return Response.json({ error: configResult.error }, { status: 422, headers });
    if (action === 'save') {
      const rows = await sql`
        update app.cards set name = ${nameResult.value.name}, config = ${JSON.stringify(configResult.value)}::jsonb, updated_at = now()
        where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid
        returning id, name, preset, status, config, published_at, updated_at
      `;
      return Response.json({ ok: true, card: rows[0] }, { headers });
    }
    const vaultRows = await sql`select ciphertext, iv from app.card_contact_vaults where profile_id = ${profile.profileId}::uuid limit 1`;
    const vaultRow = vaultRows[0] as { ciphertext: string; iv: string } | undefined;
    if (!vaultRow) return Response.json({ error: 'Save Your details before publishing a card' }, { status: 409, headers });
    const vault = await decryptCardValue<CardVault>(locals, vaultRow, `card-vault:${profile.profileId}`);
    const eligible = await eligibleCardBadges(sql, profile.profileId);
    const snapshot = buildPublicCardSnapshot({
      cardId, cardName: nameResult.value.name, preset: card.preset,
      config: configResult.value, vault, eligibleBadges: eligible,
    });
    const rows = await sql`
      with changed as (
        update app.cards set name = ${nameResult.value.name}, config = ${JSON.stringify(configResult.value)}::jsonb,
          status = 'active', published_at = now(), updated_at = now()
        where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid
        returning id, owner_profile_id, name, preset, status, config, published_at, updated_at
      ), published as (
        insert into app.card_public_snapshots (card_id, owner_profile_id, snapshot, revision)
        select id, owner_profile_id, ${JSON.stringify(snapshot)}::jsonb, 1 from changed
        on conflict (card_id) do update set snapshot = excluded.snapshot,
          revision = app.card_public_snapshots.revision + 1, updated_at = now()
        returning card_id, snapshot, revision
      )
      select changed.*, published.snapshot, published.revision from changed join published on published.card_id = changed.id
    `;
    return Response.json({ ok: true, card: rows[0] }, { headers });
  } catch {
    return Response.json({ error: 'Card could not be updated' }, { status: 503, headers });
  }
};
export const DELETE: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const cardId = params.cardId ?? '';
  if (!uuidPattern.test(cardId)) return Response.json({ error: 'Card not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Cards are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rows = await sql`delete from app.cards where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid returning id`;
    if (!rows.length) return Response.json({ error: 'Card not found' }, { status: 404, headers });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: 'Card could not be deleted' }, { status: 503, headers });
  }
};
