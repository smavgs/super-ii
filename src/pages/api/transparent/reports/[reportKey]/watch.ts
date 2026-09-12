import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { privateTransparencyHeaders } from '@/lib/transparent-http';
import { setTransparencyWatched } from '@/lib/transparent-store';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.watch', 60, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'watch limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  const body = await readBoundedJsonObject(request, 1_024, true);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateTransparencyHeaders });
  if (body.value.watched !== undefined && typeof body.value.watched !== 'boolean') return Response.json({ error: 'watched must be boolean' }, { status: 422, headers: privateTransparencyHeaders });
  try {
    const watched = body.value.watched !== false;
    const found = await setTransparencyWatched(sql, profile.profileId, params.reportKey ?? '', watched);
    if (!found) return Response.json({ error: 'report not found' }, { status: 404, headers: privateTransparencyHeaders });
    await sql`select app.record_transparency_discovery('web','watch',${params.reportKey ?? ''})`.catch(() => undefined);
    return Response.json({ ok: true, watched }, { headers: privateTransparencyHeaders });
  } catch {
    return Response.json({ error: 'watch setting could not be changed' }, { status: 503, headers: privateTransparencyHeaders });
  }
};
