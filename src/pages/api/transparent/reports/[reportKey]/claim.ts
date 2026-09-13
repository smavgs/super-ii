import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { privateTransparencyHeaders } from '@/lib/transparent-http';
import { claimTransparencyRepository } from '@/lib/transparent-store';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.claim', 20, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'claim limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  try {
    const claim = await claimTransparencyRepository(sql, profile.profileId, params.reportKey ?? '');
    return claim.ok ? Response.json({ ok: true, claim_id: claim.claimId }, { headers: privateTransparencyHeaders }) : Response.json({ error: claim.error }, { status: claim.error === 'report not found' ? 404 : 403, headers: privateTransparencyHeaders });
  } catch {
    return Response.json({ error: 'repository claim could not be verified' }, { status: 503, headers: privateTransparencyHeaders });
  }
};
