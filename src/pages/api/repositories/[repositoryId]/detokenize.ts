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
  const rateLimit = await consumeRateLimit(locals, request, sql, 'detokenize', 60, 3600);
  if (rateLimit === 'limited') return Response.json({ error: 'tokenizer rate limit reached' }, { status: 429 });
  if (rateLimit === 'unavailable') return Response.json({ error: 'tokenizer safety service unavailable' }, { status: 503 });
  const parsed = await readBoundedJsonObject(request, 1_200_000);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  if (Object.keys(payload).some((key) => !['token_ids', 'skip_special_tokens'].includes(key))) {
    return Response.json({ error: 'request contains unsupported fields' }, { status: 422 });
  }
  if (!Array.isArray(payload.token_ids) || payload.token_ids.length < 1 || payload.token_ids.length > 100_000
    || payload.token_ids.some((value) => !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647)) {
    return Response.json({ error: 'token_ids must contain 1 to 100000 non-negative 32-bit integers' }, { status: 422 });
  }
  if (payload.skip_special_tokens !== undefined && typeof payload.skip_special_tokens !== 'boolean') {
    return Response.json({ error: 'skip_special_tokens must be boolean' }, { status: 422 });
  }
  const rows = await sql`select latest_revision_id from app.repositories where id = ${params.repositoryId ?? ''}::uuid and kind = 'model' and visibility = 'public' and status = 'published' limit 1`.catch(() => []);
  if (!rows.length || !rows[0].latest_revision_id) return Response.json({ error: 'model not found' }, { status: 404 });
  const upstream = await runtimeFetch(locals, `/v1/repositories/${params.repositoryId}/revisions/${String(rows[0].latest_revision_id)}/detokenize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token_ids: payload.token_ids, skip_special_tokens: payload.skip_special_tokens === true }),
  });
  if (!upstream) return Response.json({ error: 'tokenizer runtime unavailable' }, { status: 503 });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
