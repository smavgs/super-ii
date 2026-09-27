import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { encryptCardValue } from '@/lib/card-crypto';
import { sqlClient } from '@/lib/db';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { 'cache-control': 'private, no-store' };

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const connectionId = params.connectionId ?? '';
  if (!uuidPattern.test(connectionId)) return Response.json({ error: 'Connection not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Connections are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const body = await readBoundedJsonObject(request, 8192);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers });
    const note = typeof body.value.note === 'string' ? body.value.note.trim() : '';
    const context = typeof body.value.context === 'string' ? body.value.context.trim() : '';
    if (note.length > 4000 || context.length > 160) return Response.json({ error: 'Connection note is too long' }, { status: 422, headers });
    const connectionRows = await sql`select card_id from app.card_connections where id = ${connectionId}::uuid and owner_profile_id = ${profile.profileId}::uuid limit 1`;
    const cardId = connectionRows[0]?.card_id;
    if (!cardId) return Response.json({ error: 'Connection not found' }, { status: 404, headers });
    const encrypted = await encryptCardValue(locals, { note, context }, `card-connection:${String(cardId)}`);
    await sql`update app.card_connections set context_ciphertext = ${encrypted.ciphertext}, context_iv = ${encrypted.iv}, updated_at = now() where id = ${connectionId}::uuid and owner_profile_id = ${profile.profileId}::uuid`;
    return Response.json({ ok: true, note, context }, { headers });
  } catch {
    return Response.json({ error: 'Connection note could not be saved' }, { status: 503, headers });
  }
};
export const DELETE: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const connectionId = params.connectionId ?? '';
  if (!uuidPattern.test(connectionId)) return Response.json({ error: 'Connection not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Connections are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rows = await sql`delete from app.card_connections where id = ${connectionId}::uuid and owner_profile_id = ${profile.profileId}::uuid returning id`;
    if (!rows.length) return Response.json({ error: 'Connection not found' }, { status: 404, headers });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: 'Connection could not be deleted' }, { status: 503, headers });
  }
};
