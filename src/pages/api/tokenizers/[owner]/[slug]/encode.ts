import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { acceptsPublicMachineRequest, resolveTokenizerModel, tokenizerJson, tokenizerResponse } from '@/lib/tokenizers';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!acceptsPublicMachineRequest(request)) return tokenizerResponse(403, { error: 'invalid origin' });
  const sql = sqlClient(locals);
  if (!sql) return tokenizerResponse(503, { error: 'database unavailable' });
  const limited = await consumeRateLimit(locals, request, sql, 'tokenizer-encode', 120, 3600);
  if (limited === 'limited') return tokenizerResponse(429, { error: 'tokenizer rate limit reached' });
  if (limited === 'unavailable') return tokenizerResponse(503, { error: 'tokenizer safety service unavailable' });
  const parsed = await readBoundedJsonObject(request, 1_000_000);
  if (!parsed.ok) return tokenizerResponse(parsed.status, { error: parsed.error });
  const body = parsed.value;
  if (Object.keys(body).some((key) => !['text', 'add_special_tokens'].includes(key))) {
    return tokenizerResponse(422, { error: 'request contains unsupported fields' });
  }
  if (typeof body.text !== 'string' || body.text.length > 100_000) return tokenizerResponse(422, { error: 'text must contain at most 100000 characters' });
  if (body.add_special_tokens !== undefined && typeof body.add_special_tokens !== 'boolean') return tokenizerResponse(422, { error: 'add_special_tokens must be boolean' });
  const revision = new URL(request.url).searchParams.get('revision') ?? undefined;
  const resolved = await resolveTokenizerModel(locals, params.owner ?? '', params.slug ?? '', revision);
  if (!resolved.model) return tokenizerResponse(resolved.state === 'not_found' ? 404 : 503, { error: resolved.state === 'not_found' ? 'model not found' : 'repository service unavailable' });
  const result = await tokenizerJson(locals, resolved.model, 'encode', {
    text: body.text,
    add_special_tokens: body.add_special_tokens !== false,
  });
  return tokenizerResponse(result.status, result.value);
};
