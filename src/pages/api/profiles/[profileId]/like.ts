import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privateHeaders = { 'cache-control': 'private, no-store' };

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateHeaders });
  const targetProfileId = params.profileId ?? '';
  if (!uuidPattern.test(targetProfileId)) return Response.json({ error: 'profile not found' }, { status: 404, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'profile.like', 120, 3600);
  if (rate !== 'allowed') {
    return Response.json(
      { error: rate === 'limited' ? 'profile like limit reached' : 'safety service unavailable' },
      { status: rate === 'limited' ? 429 : 503, headers: { ...privateHeaders, ...(rate === 'limited' ? { 'retry-after': '3600' } : {}) } },
    );
  }
  const parsed = await readBoundedJsonObject(request, 2048);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (typeof parsed.value.active !== 'boolean' || Object.keys(parsed.value).some((key) => key !== 'active')) {
    return Response.json({ error: 'active must be the only field and must be boolean' }, { status: 422, headers: privateHeaders });
  }
  try {
    const rows = await sql`
      select active, likes_count
      from app.set_profile_like(
        ${profile.profileId}::uuid,
        ${targetProfileId}::uuid,
        ${parsed.value.active}
      )
    `;
    if (!rows.length) return Response.json({ error: 'profile not found' }, { status: 404, headers: privateHeaders });
    return Response.json({ ok: true, active: rows[0]?.active === true, likes_count: Number(rows[0]?.likes_count ?? 0) }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'profile like could not be updated' }, { status: 422, headers: privateHeaders });
  }
};
