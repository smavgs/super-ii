import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { runtimeValue, sqlClient } from '@/lib/db';
import {
  OPENROUTER_CHAT_ENDPOINT,
  OPENROUTER_MODEL,
  openRouterAnswer,
  openRouterChatRequest,
  parseAssistantMessages,
} from '@/lib/openrouter';
import { consumeRateLimit } from '@/lib/rate-limit';

const MAX_REQUEST_CHARS = 16_000;

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

function retryAfter(upstream: Response): string {
  const value = upstream.headers.get('retry-after');
  return value && /^\d{1,6}$/.test(value) ? value : '60';
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

  const rawBody = await request.text().catch(() => '');
  if (!rawBody || rawBody.length > MAX_REQUEST_CHARS) {
    return json({ error: rawBody ? 'assistant request too large' : 'invalid assistant request' }, rawBody ? 413 : 400);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: 'invalid assistant request' }, 400);
  }

  const messages = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? parseAssistantMessages((input as Record<string, unknown>).messages)
    : null;
  if (!messages) return json({ error: 'invalid assistant conversation' }, 400);

  const rate = await consumeRateLimit(locals, request, sql, 'assistant.chat', 30, 3600);
  if (rate !== 'allowed') {
    return json(
      { error: rate === 'limited' ? 'assistant message limit reached' : 'assistant safety service unavailable' },
      rate === 'limited' ? 429 : 503,
      rate === 'limited' ? { 'retry-after': '3600' } : {},
    );
  }

  const apiKey = runtimeValue(locals, 'OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'assistant is not configured' }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://www.superii.site',
        'X-OpenRouter-Title': 'Super ii',
      },
      body: JSON.stringify(openRouterChatRequest(messages)),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'assistant provider request failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    console.error(JSON.stringify({
      message: 'assistant provider rejected request',
      status: upstream.status,
    }));
    return json(
      { error: upstream.status === 429 ? 'assistant is busy' : 'assistant connection unavailable' },
      upstream.status === 429 ? 429 : 503,
      upstream.status === 429 ? { 'retry-after': retryAfter(upstream) } : {},
    );
  }

  const answer = openRouterAnswer(payload);
  if (!answer) {
    console.error(JSON.stringify({ message: 'assistant provider returned no answer' }));
    return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });
  }

  return json({ answer, model: OPENROUTER_MODEL }, 200);
};
