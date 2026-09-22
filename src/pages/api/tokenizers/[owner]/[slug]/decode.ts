import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { acceptsPublicMachineRequest, resolveTokenizerModel, tokenizerJson, tokenizerResponse } from '@/lib/tokenizers';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!acceptsPublicMachineRequest(request)) return tokenizerResponse(403, { error: 'invalid origin' });
  const sql = sqlClient(locals);
  if (!sql) return tokenizerResponse(503, { error: 'database unavailable' });
  const limited = await consumeRateLimit(locals, request, sql, 'tokenizer-decode', 120, 3600);
  if (limited === 'limited') return tokenizerResponse(429, { error: 'tokenizer rate limit reached' });
  if (limited === 'unavailable') return tokenizerResponse(503, { error: 'tokenizer safety service unavailable' });
  const parsed = await readBoundedJsonObject(request, 1_200_000);
  if (!parsed.ok) return tokenizerResponse(parsed.status, { error: parsed.error });
  const body = parsed.value;
  if (Object.keys(body).some((key) => !['token_ids', 'skip_special_tokens'].includes(key))) {
    return tokenizerResponse(422, { error: 'request contains unsupported fields' });
  }
  if (!Array.isArray(body.token_ids) || body.token_ids.length < 1 || body.token_ids.length > 100_000
    || body.token_ids.some((value) => !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647)) {
    return tokenizerResponse(422, { error: 'token_ids must contain 1 to 100000 non-negative 32-bit integers' });
  }
  if (body.skip_special_tokens !== undefined && typeof body.skip_special_tokens !== 'boolean') return tokenizerResponse(422, { error: 'skip_special_tokens must be boolean' });
  const revision = new URL(request.url).searchParams.get('revision') ?? undefined;
  const resolved = await resolveTokenizerModel(locals, params.owner ?? '', params.slug ?? '', revision);
  if (!resolved.model) return tokenizerResponse(resolved.state === 'not_found' ? 404 : 503, { error: resolved.state === 'not_found' ? 'model not found' : 'repository service unavailable' });
  const result = await tokenizerJson(locals, resolved.model, 'decode', {
    token_ids: body.token_ids,
    skip_special_tokens: body.skip_special_tokens === true,
  });
  return tokenizerResponse(result.status, result.value);
};
