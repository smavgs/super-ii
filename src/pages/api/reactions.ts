import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const targets = new Set(['discussion', 'comment']);
const reactions = new Set(['like', 'helpful', 'celebrate', 'heart', 'eyes']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'reaction.set', 300, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'reaction rate limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503, headers: rateLimit === 'limited' ? { 'retry-after': '3600' } : {} },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (
    typeof payload.target_type !== 'string'
    || !targets.has(payload.target_type)
    || typeof payload.target_id !== 'string'
    || !uuidPattern.test(payload.target_id)
    || typeof payload.reaction !== 'string'
    || !reactions.has(payload.reaction)
    || typeof payload.active !== 'boolean'
  ) {
    return Response.json({ error: 'invalid reaction request' }, { status: 422 });
  }

  try {
    const rows = await sql`
      select app.set_reaction(
        ${profile.profileId}::uuid,
        ${payload.target_type},
        ${payload.target_id}::uuid,
        ${payload.reaction},
        ${payload.active}
      ) as active
    `;
    return Response.json({ ok: true, active: rows[0]?.active });
  } catch {
    return Response.json({ error: 'reaction could not be updated' }, { status: 422 });
  }
};
