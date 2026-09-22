import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { acceptsPublicMachineRequest, resolveTokenizerModel, tokenizerJson, tokenizerResponse } from '@/lib/tokenizers';

export const GET: APIRoute = async ({ locals, params, request }) => {
  if (!acceptsPublicMachineRequest(request)) return tokenizerResponse(403, { error: 'invalid origin' });
  const sql = sqlClient(locals);
  if (!sql) return tokenizerResponse(503, { error: 'database unavailable' });
  const limited = await consumeRateLimit(locals, request, sql, 'tokenizer-manifest', 240, 3600);
  if (limited === 'limited') return tokenizerResponse(429, { error: 'tokenizer rate limit reached' });
  if (limited === 'unavailable') return tokenizerResponse(503, { error: 'tokenizer safety service unavailable' });
  const revision = new URL(request.url).searchParams.get('revision') ?? undefined;
  const resolved = await resolveTokenizerModel(locals, params.owner ?? '', params.slug ?? '', revision);
  if (!resolved.model) return tokenizerResponse(resolved.state === 'not_found' ? 404 : 503, { error: resolved.state === 'not_found' ? 'model not found' : 'repository service unavailable' });
  const result = await tokenizerJson(locals, resolved.model, 'manifest');
  return tokenizerResponse(result.status, result.value, true);
};
