import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'expected JSON' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 110_000) {
    return Response.json({ error: 'request is too large' }, { status: 413 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'tokenize', 60, 3600);
  if (rateLimit === 'limited') {
    return Response.json({ error: 'tokenizer rate limit reached' }, { status: 429, headers: { 'retry-after': '3600' } });
  }
  if (rateLimit === 'unavailable') {
    return Response.json({ error: 'tokenizer safety service unavailable' }, { status: 503 });
  }
  const repositoryId = params.repositoryId ?? '';
  let payload: { text?: unknown; add_special_tokens?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof payload.text !== 'string' || payload.text.length > 100_000) {
    return Response.json({ error: 'text must contain at most 100000 characters' }, { status: 400 });
  }
  let revisionId: string;
  try {
    const rows = await sql`
      select latest_revision_id
      from app.repositories
      where id = ${repositoryId}::uuid
        and kind = 'model'
        and visibility = 'public'
        and status = 'published'
      limit 1
    `;
    if (!rows.length || !rows[0].latest_revision_id) {
      return Response.json({ error: 'model not found' }, { status: 404 });
    }
    revisionId = String(rows[0].latest_revision_id);
  } catch {
    return Response.json({ error: 'model not found' }, { status: 404 });
  }

  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${revisionId}/tokenize`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        add_special_tokens: payload.add_special_tokens !== false,
      }),
    },
  );
  if (!upstream) return Response.json({ error: 'tokenizer runtime unavailable' }, { status: 503 });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
