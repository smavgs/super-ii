import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { encryptCardValue, hashCardToken, validCardToken } from '@/lib/card-crypto';
import { isCardPublicSnapshot } from '@/lib/card-data';
import { validEmailAddress } from '@/lib/cards';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = { 'cache-control': 'no-store' };

function field(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum + 1) : '';
}

export const POST: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const token = params.token ?? '';
  if (!validCardToken(token)) return Response.json({ error: 'Card not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Sharing is unavailable' }, { status: 503, headers });
  try {
    const rate = await consumeRateLimit(locals, request, sql, 'cards.share-back', 10, 86400);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Share-back limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
    const tokenHash = await hashCardToken(token);
    const cardRows = await sql`select card_id, snapshot from app.resolve_public_card(${tokenHash})`;
    const card = cardRows[0] as { card_id?: string; snapshot?: unknown } | undefined;
    if (!card?.card_id || !isCardPublicSnapshot(card.snapshot) || !card.snapshot.allow_share_back) return Response.json({ error: 'Card not found' }, { status: 404, headers });
    const body = await readBoundedJsonObject(request, 8192);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers });
    const allowedFields = new Set(['name', 'email', 'phone', 'message']);
    if (Object.keys(body.value).some((key) => !allowedFields.has(key))) {
      return Response.json({ error: 'Contact details contain an unsupported field' }, { status: 422, headers });
    }
    const name = field(body.value.name, 100);
    const email = field(body.value.email, 254);
    const phone = field(body.value.phone, 40);
    const message = field(body.value.message, 1000);
    if (!name || (!email && !phone) || name.length > 100 || email.length > 254 || phone.length > 40 || message.length > 1000) {
      return Response.json({ error: 'Add your name and an email or phone number' }, { status: 422, headers });
    }
    if (email && !validEmailAddress(email)) return Response.json({ error: 'Enter a valid email address' }, { status: 422, headers });
    const encrypted = await encryptCardValue(locals, { name, email, phone, message }, `card-connection:${card.card_id}`);
    const rows = await sql`select app.submit_card_connection(${tokenHash}, ${encrypted.ciphertext}, ${encrypted.iv}, null, null) as id`;
    if (!rows[0]?.id) return Response.json({ error: 'Connection could not be shared' }, { status: 409, headers });
    return Response.json({ ok: true }, { status: 201, headers });
  } catch {
    return Response.json({ error: 'Connection could not be shared' }, { status: 503, headers });
  }
};
