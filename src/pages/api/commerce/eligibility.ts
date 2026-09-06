import type { APIRoute } from 'astro';
import { checkCommerceEligibility, commerceErrorResponse, commerceOrderInputSchema } from '@/lib/commerce';
import { commerceCorsHeaders, commerceJson, commerceOptionsResponse } from '@/lib/commerce-http';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const OPTIONS: APIRoute = async () => commerceOptionsResponse();

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return commerceJson({ error: 'database_unavailable', message: 'Commerce database is unavailable.' }, 503);
  const rate = await consumeRateLimit(locals, request, sql, 'commerce.eligibility', 120, 3600);
  if (rate !== 'allowed') {
    return commerceJson({
      error: rate === 'limited' ? 'rate_limited' : 'safety_service_unavailable',
      message: rate === 'limited' ? 'Commerce eligibility rate limit reached.' : 'Commerce safety service is unavailable.',
    }, rate === 'limited' ? 429 : 503, rate === 'limited' ? { 'retry-after': '3600' } : {});
  }
  const body = await readBoundedJsonObject(request, 8192);
  if (!body.ok) return commerceJson({ error: 'invalid_request', message: body.error }, body.status);
  const parsed = commerceOrderInputSchema.safeParse(body.value);
  if (!parsed.success) {
    return commerceJson({ error: 'invalid_order', message: parsed.error.issues[0]?.message ?? 'Invalid order.' }, 422);
  }
  try {
    return commerceJson(await checkCommerceEligibility(request, sql, parsed.data));
  } catch (error) {
    const response = commerceErrorResponse(error);
    const headers = new Headers(response.headers);
    Object.entries(commerceCorsHeaders).forEach(([key, value]) => headers.set(key, String(value)));
    return new Response(response.body, { status: response.status, headers });
  }
};
