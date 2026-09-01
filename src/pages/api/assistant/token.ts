import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { runtimeValue, sqlClient } from '@/lib/db';
import { geminiEphemeralTokenRequest } from '@/lib/gemini-live';
import { consumeRateLimit } from '@/lib/rate-limit';

const tokenEndpoint = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

function json(body: Record<string, unknown>, status: number, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store, private',
      pragma: 'no-cache',
      vary: 'Cookie',
      ...extraHeaders,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return json({ error: 'invalid origin' }, 403);

  const sql = sqlClient(locals);
  if (!sql) return json({ error: 'assistant safety service unavailable' }, 503);

  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return json({ error: 'authentication required' }, 401);
  } catch {
    return json({ error: 'authentication service unavailable' }, 503);
  }

  const rate = await consumeRateLimit(locals, request, sql, 'assistant.token', 8, 3600);
  if (rate !== 'allowed') {
    return json(
      { error: rate === 'limited' ? 'assistant session limit reached' : 'assistant safety service unavailable' },
      rate === 'limited' ? 429 : 503,
      rate === 'limited' ? { 'retry-after': '3600' } : {},
    );
  }

  const apiKey = runtimeValue(locals, 'GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'assistant is not configured' }, 503);

  const now = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiEphemeralTokenRequest(now)),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'assistant token request failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok || !isRecord(payload) || typeof payload.name !== 'string') {
    const retryAfter = upstream.headers.get('retry-after');
    console.error(JSON.stringify({
      message: 'assistant token service rejected request',
      status: upstream.status,
    }));
    return json(
      { error: upstream.status === 429 ? 'assistant is busy' : 'assistant connection unavailable' },
      upstream.status === 429 ? 429 : 503,
      retryAfter ? { 'retry-after': retryAfter } : {},
    );
  }

  return json({
    token: payload.name,
    expires_at: new Date(now + 15 * 60_000).toISOString(),
  }, 201);
};
