import type { APIRoute } from 'astro';
import { commerceErrorResponse, commerceQuoteInputSchema, createCommerceQuoteRequest } from '@/lib/commerce';
import { commerceCorsHeaders, commerceJson, commerceOptionsResponse, requestIdempotencyKey } from '@/lib/commerce-http';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit, requestNetworkHash } from '@/lib/rate-limit';

export const OPTIONS: APIRoute = async () => commerceOptionsResponse();

export const POST: APIRoute = async ({ locals, request }) => {
  const idempotencyKey = requestIdempotencyKey(request);
  if (!idempotencyKey) {
    return commerceJson({ error: 'idempotency_key_required', message: 'Send a stable 16-200 character Idempotency-Key header.' }, 400);
  }
  const sql = sqlClient(locals);
  if (!sql) return commerceJson({ error: 'database_unavailable', message: 'Commerce database is unavailable.' }, 503);
  const rate = await consumeRateLimit(locals, request, sql, 'commerce.quote.create', 10, 86400);
  if (rate !== 'allowed') {
    return commerceJson({
      error: rate === 'limited' ? 'rate_limited' : 'safety_service_unavailable',
      message: rate === 'limited' ? 'Enterprise quote request limit reached.' : 'Commerce safety service is unavailable.',
    }, rate === 'limited' ? 429 : 503, rate === 'limited' ? { 'retry-after': '86400' } : {});
  }
  const networkHash = await requestNetworkHash(locals, request, 'commerce-quote');
  if (!networkHash) return commerceJson({ error: 'safety_service_unavailable', message: 'Commerce safety service is unavailable.' }, 503);
  const body = await readBoundedJsonObject(request, 8192);
  if (!body.ok) return commerceJson({ error: 'invalid_request', message: body.error }, body.status);
  const parsed = commerceQuoteInputSchema.safeParse(body.value);
  if (!parsed.success) {
    return commerceJson({ error: 'invalid_quote_request', message: parsed.error.issues[0]?.message ?? 'Invalid quote request.' }, 422);
  }
  try {
    const result = await createCommerceQuoteRequest(request, sql, idempotencyKey, parsed.data, networkHash);
    return commerceJson(result, result.replayed === true ? 200 : 201);
  } catch (error) {
    const response = commerceErrorResponse(error);
    const headers = new Headers(response.headers);
    Object.entries(commerceCorsHeaders).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  }
};
