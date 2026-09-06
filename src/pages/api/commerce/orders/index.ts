import type { APIRoute } from 'astro';
import { createCommerceOrder, commerceErrorResponse, commerceOrderInputSchema } from '@/lib/commerce';
import { commerceCorsHeaders, commerceJson, commerceOptionsResponse, requestIdempotencyKey } from '@/lib/commerce-http';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { nowPaymentsConfigured } from '@/lib/nowpayments';
import { consumeRateLimit } from '@/lib/rate-limit';

export const OPTIONS: APIRoute = async () => commerceOptionsResponse();

export const POST: APIRoute = async ({ locals, request }) => {
  const idempotencyKey = requestIdempotencyKey(request);
  if (!idempotencyKey) {
    return commerceJson({ error: 'idempotency_key_required', message: 'Send a stable 16-200 character Idempotency-Key header.' }, 400);
  }
  const sql = sqlClient(locals);
  if (!sql) return commerceJson({ error: 'database_unavailable', message: 'Commerce database is unavailable.' }, 503);
  if (!nowPaymentsConfigured(locals)) {
    return commerceJson({ error: 'payment_provider_unavailable', message: 'USDC checkout is not configured.' }, 503);
  }
  const rate = await consumeRateLimit(locals, request, sql, 'commerce.order.create', 30, 3600);
  if (rate !== 'allowed') {
    return commerceJson({
      error: rate === 'limited' ? 'rate_limited' : 'safety_service_unavailable',
      message: rate === 'limited' ? 'Commerce order rate limit reached.' : 'Commerce safety service is unavailable.',
    }, rate === 'limited' ? 429 : 503, rate === 'limited' ? { 'retry-after': '3600' } : {});
  }
  const body = await readBoundedJsonObject(request, 8192);
  if (!body.ok) return commerceJson({ error: 'invalid_request', message: body.error }, body.status);
  const parsed = commerceOrderInputSchema.safeParse(body.value);
  if (!parsed.success) {
    return commerceJson({ error: 'invalid_order', message: parsed.error.issues[0]?.message ?? 'Invalid order.' }, 422);
  }
  try {
    const result = await createCommerceOrder(locals, request, sql, idempotencyKey, parsed.data);
    const order = result.order as Record<string, unknown> | undefined;
    const location = order?.links && typeof order.links === 'object' && 'self' in order.links
      ? String((order.links as Record<string, unknown>).self)
      : undefined;
    return commerceJson(result, result.replayed === true ? 200 : 201, location ? { location } : {});
  } catch (error) {
    const response = commerceErrorResponse(error);
    const headers = new Headers(response.headers);
    Object.entries(commerceCorsHeaders).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  }
};
