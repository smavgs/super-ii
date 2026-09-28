import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { createCardToken, decryptCardValue, encryptCardValue, hashCardToken } from '@/lib/card-crypto';
import { eligibleCardBadges } from '@/lib/card-data';
import {
  defaultCardConfig, emptyCardVault, parseCardCreate,
  type CardConfig, type CardVault,
} from '@/lib/cards';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const privateHeaders = { 'cache-control': 'private, no-store' };

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Cards are unavailable' }, { status: 503, headers: privateHeaders });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers: privateHeaders });
    const [profileRows, vaultRows, cardRows, connectionRows, eligibleBadges] = await Promise.all([
      sql`select display_name, avatar_url from app.profiles where id = ${profile.profileId}::uuid limit 1`,
      sql`select ciphertext, iv from app.card_contact_vaults where profile_id = ${profile.profileId}::uuid limit 1`,
      sql`select card.id, card.name, card.preset, card.status, card.config, card.published_at,
                 card.share_token_ciphertext, card.share_token_iv, card.updated_at,
                 snapshot.snapshot, snapshot.revision
          from app.cards card
          left join app.card_public_snapshots snapshot on snapshot.card_id = card.id
          where card.owner_profile_id = ${profile.profileId}::uuid
          order by card.updated_at desc limit 24`,
      sql`select connection.id, connection.card_id, connection.payload_ciphertext,
                 connection.payload_iv, connection.context_ciphertext, connection.context_iv,
                 connection.created_at, connection.updated_at, card.name as card_name
          from app.card_connections connection
          join app.cards card on card.id = connection.card_id
          where connection.owner_profile_id = ${profile.profileId}::uuid
          order by connection.created_at desc limit 100`,
      eligibleCardBadges(sql, profile.profileId),
    ]);
    const profileRow = profileRows[0] as { display_name?: string; avatar_url?: string | null } | undefined;
    let vault = emptyCardVault(profileRow?.display_name ?? '');
    vault.photo_url = profileRow?.avatar_url ?? '';
    const vaultRow = vaultRows[0] as { ciphertext: string; iv: string } | undefined;
    if (vaultRow) {
      vault = await decryptCardValue<CardVault>(locals, vaultRow, `card-vault:${profile.profileId}`);
    }
    const cards = await Promise.all(cardRows.map(async (row) => {
      const card = row as Record<string, unknown>;
      const token = await decryptCardValue<string>(locals, {
        ciphertext: String(card.share_token_ciphertext), iv: String(card.share_token_iv),
      }, `card-token:${profile.profileId}`);
      return {
        id: card.id,
        name: card.name,
        preset: card.preset,
        status: card.status,
        config: card.config as CardConfig,
        published_at: card.published_at,
        updated_at: card.updated_at,
        revision: card.revision,
        snapshot: card.snapshot,
        token,
        path: `/c/${token}`,
      };
    }));
    const connections = await Promise.all(connectionRows.map(async (row) => {
      const connection = row as Record<string, unknown>;
      const payload = await decryptCardValue<Record<string, string>>(locals, {
        ciphertext: String(connection.payload_ciphertext), iv: String(connection.payload_iv),
      }, `card-connection:${String(connection.card_id)}`);
      let context: Record<string, string> = {};
      if (connection.context_ciphertext && connection.context_iv) {
        context = await decryptCardValue<Record<string, string>>(locals, {
          ciphertext: String(connection.context_ciphertext), iv: String(connection.context_iv),
        }, `card-connection:${String(connection.card_id)}`);
      }
      return {
        id: connection.id,
        card_id: connection.card_id,
        card_name: connection.card_name,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
        ...payload,
        ...context,
      };
    }));
    return Response.json({ cards, connections, vault, eligible_badges: eligibleBadges }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'Cards could not be loaded' }, { status: 503, headers: privateHeaders });
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Cards are unavailable' }, { status: 503, headers: privateHeaders });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers: privateHeaders });
    const rate = await consumeRateLimit(locals, request, sql, 'cards.create', 24, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Card creation limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateHeaders });
    const body = await readBoundedJsonObject(request, 4096);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateHeaders });
    const parsed = parseCardCreate(body.value);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 422, headers: privateHeaders });
    const countRows = await sql`select count(*)::integer as count from app.cards where owner_profile_id = ${profile.profileId}::uuid`;
    if (Number(countRows[0]?.count ?? 0) >= 24) return Response.json({ error: 'You can keep up to 24 cards' }, { status: 409, headers: privateHeaders });
    const token = createCardToken();
    const tokenHash = await hashCardToken(token);
    const encrypted = await encryptCardValue(locals, token, `card-token:${profile.profileId}`);
    const config = defaultCardConfig(parsed.value.preset);
    const rows = await sql`
      insert into app.cards (
        owner_profile_id, name, preset, share_token_hash,
        share_token_ciphertext, share_token_iv, config
      ) values (
        ${profile.profileId}::uuid, ${parsed.value.name}, ${parsed.value.preset}, ${tokenHash},
        ${encrypted.ciphertext}, ${encrypted.iv}, ${JSON.stringify(config)}::jsonb
      ) returning id, name, preset, status, config, created_at, updated_at
    `;
    return Response.json({ card: { ...rows[0], token, path: `/c/${token}` } }, { status: 201, headers: privateHeaders });
  } catch {
    return Response.json({ error: 'Card could not be created' }, { status: 503, headers: privateHeaders });
  }
};
