import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { privateTransparencyHeaders } from '@/lib/transparent-http';
import { setTransparencySaved } from '@/lib/transparent-store';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.save', 120, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'save limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  const body = await readBoundedJsonObject(request, 1_024, true);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateTransparencyHeaders });
  if (body.value.saved !== undefined && typeof body.value.saved !== 'boolean') return Response.json({ error: 'saved must be boolean' }, { status: 422, headers: privateTransparencyHeaders });
  try {
    const saved = body.value.saved !== false;
    const found = await setTransparencySaved(sql, profile.profileId, params.reportKey ?? '', saved);
    return found ? Response.json({ ok: true, saved }, { headers: privateTransparencyHeaders }) : Response.json({ error: 'report not found' }, { status: 404, headers: privateTransparencyHeaders });
  } catch {
    return Response.json({ error: 'report could not be saved' }, { status: 503, headers: privateTransparencyHeaders });
  }
};
