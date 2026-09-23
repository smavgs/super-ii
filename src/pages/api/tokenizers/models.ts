import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { searchTokenizerModels } from '@/lib/tokenizer-models';
import { acceptsPublicMachineRequest, tokenizerResponse } from '@/lib/tokenizers';

const querySchema = z.object({
  q: z.string().trim().max(300).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(10)).optional(),
}).strict();

export const GET: APIRoute = async ({ locals, request }) => {
  if (!acceptsPublicMachineRequest(request)) return tokenizerResponse(403, { error: 'invalid origin' });
  const sql = sqlClient(locals);
  if (!sql) return tokenizerResponse(503, { error: 'database unavailable' });
  const limited = await consumeRateLimit(locals, request, sql, 'tokenizer-model-search', 240, 3600);
  if (limited === 'limited') return tokenizerResponse(429, { error: 'tokenizer model search rate limit reached' });
  if (limited === 'unavailable') return tokenizerResponse(503, { error: 'tokenizer safety service unavailable' });

  const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (new URL(request.url).searchParams.size !== Object.keys(raw).length) {
    return tokenizerResponse(400, { error: 'search parameters must appear exactly once' });
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return tokenizerResponse(400, { error: 'invalid tokenizer model search' });

  const result = await searchTokenizerModels(locals, parsed.data.q ?? '', parsed.data.limit ?? 8);
  if (result.state !== 'ok') return tokenizerResponse(503, { error: 'tokenizer model search unavailable' });
  return tokenizerResponse(200, { state: 'ok', items: result.items }, true);
};
