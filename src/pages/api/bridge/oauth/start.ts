import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { beginHuggingFaceOAuth, bridgeIsConfigured, type BridgeAccess } from '@/lib/bridge';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const accessLevels = new Set<BridgeAccess>(['public', 'private', 'gated', 'organizations']);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql || !bridgeIsConfigured(locals)) return Response.json({ error: 'Bridge is unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const allowed = await consumeRateLimit(locals, request, sql, 'bridge.oauth', 20, 3600);
  if (allowed !== 'allowed') {
    return Response.json({ error: allowed === 'limited' ? 'connection limit reached' : 'safety service unavailable' }, { status: allowed === 'limited' ? 429 : 503 });
  }
  let payload: Record<string, unknown> = {};
  try { payload = await request.json() as Record<string, unknown>; } catch {}
  const requested = typeof payload.access === 'string' ? payload.access as BridgeAccess : 'public';
  const access = accessLevels.has(requested) ? requested : 'public';
  try {
    const authorizationUrl = await beginHuggingFaceOAuth(locals, sql, profile.profileId, access);
    return Response.json({ authorization_url: authorizationUrl }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Hugging Face connection could not be started' }, { status: 503 });
  }
};
