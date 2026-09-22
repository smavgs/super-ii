import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
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
  const parsed = await readBoundedJsonObject(request, 1_000_000);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  if (Object.keys(payload).some((key) => !['text', 'add_special_tokens'].includes(key))) {
    return Response.json({ error: 'request contains unsupported fields' }, { status: 422 });
  }
  if (typeof payload.text !== 'string' || payload.text.length > 100_000) {
    return Response.json({ error: 'text must contain at most 100000 characters' }, { status: 422 });
  }
  if (payload.add_special_tokens !== undefined && typeof payload.add_special_tokens !== 'boolean') {
    return Response.json({ error: 'add_special_tokens must be boolean' }, { status: 422 });
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
