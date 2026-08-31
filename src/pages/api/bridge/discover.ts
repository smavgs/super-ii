import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import {
  bridgeIdentityToken,
  detectBridgeSource,
  discoverHuggingFaceRepositories,
} from '@/lib/bridge';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const allowed = await consumeRateLimit(locals, request, sql, 'bridge.discover', 30, 3600);
  if (allowed !== 'allowed') {
    return Response.json({ error: allowed === 'limited' ? 'discovery limit reached' : 'safety service unavailable' }, { status: allowed === 'limited' ? 429 : 503 });
  }
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const identityId = typeof payload.identity_id === 'string' ? payload.identity_id : null;
  try {
    const credentials = await bridgeIdentityToken(locals, sql, profile.profileId, identityId);
    const rawSource = typeof payload.source_url === 'string' && payload.source_url.trim()
      ? payload.source_url
      : credentials.identity
        ? `https://huggingface.co/${credentials.identity.provider_username}`
        : '';
    const source = detectBridgeSource(rawSource);
    if (!source) return Response.json({ error: 'Paste a supported profile or repository HTTPS link' }, { status: 422 });
    const repositories = await discoverHuggingFaceRepositories(
      source,
      credentials.token,
      credentials.identity?.scopes ?? [],
    );
    return Response.json({
      source,
      identity: credentials.identity,
      repositories,
      counts: {
        total: repositories.length,
        ready: repositories.filter((repository) => !repository.blocked_reason).length,
        models: repositories.filter((repository) => repository.kind === 'model').length,
        datasets: repositories.filter((repository) => repository.kind === 'dataset').length,
        spaces: repositories.filter((repository) => repository.kind === 'space').length,
      },
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : '';
    const code = /^[a-z0-9_]{1,120}$/.test(rawCode) ? rawCode : 'discovery_failed';
    const status = code === 'provider_rate_limited' ? 429 : code.includes('authorization') ? 403 : 503;
    return Response.json({ error: code.replaceAll('_', ' ') }, { status, headers: { 'cache-control': 'no-store' } });
  }
};
