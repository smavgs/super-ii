import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { createCardToken, encryptCardValue, hashCardToken } from '@/lib/card-crypto';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { 'cache-control': 'private, no-store' };

export const POST: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const cardId = params.cardId ?? '';
  if (!uuidPattern.test(cardId)) return Response.json({ error: 'Card not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Cards are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rate = await consumeRateLimit(locals, request, sql, 'cards.rotate', 12, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Link rotation limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
    const token = createCardToken();
    const encrypted = await encryptCardValue(locals, token, `card-token:${profile.profileId}`);
    const rows = await sql`
      update app.cards set share_token_hash = ${await hashCardToken(token)},
        share_token_ciphertext = ${encrypted.ciphertext}, share_token_iv = ${encrypted.iv}, updated_at = now()
      where id = ${cardId}::uuid and owner_profile_id = ${profile.profileId}::uuid
      returning id
    `;
    if (!rows.length) return Response.json({ error: 'Card not found' }, { status: 404, headers });
    return Response.json({ ok: true, token, path: `/c/${token}` }, { headers });
  } catch {
    return Response.json({ error: 'Card link could not be rotated' }, { status: 503, headers });
  }
};
