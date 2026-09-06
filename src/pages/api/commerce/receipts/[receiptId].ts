import type { APIRoute } from 'astro';
import { commerceErrorResponse, getCommerceReceipt } from '@/lib/commerce';
import { commerceCorsHeaders, commerceJson, commerceOptionsResponse } from '@/lib/commerce-http';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const OPTIONS: APIRoute = async () => commerceOptionsResponse();

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return commerceJson({ error: 'database_unavailable', message: 'Commerce database is unavailable.' }, 503);
  const rate = await consumeRateLimit(locals, request, sql, 'commerce.receipt.read', 600, 3600);
  if (rate !== 'allowed') {
    return commerceJson({
      error: rate === 'limited' ? 'rate_limited' : 'safety_service_unavailable',
      message: rate === 'limited' ? 'Commerce receipt read limit reached.' : 'Commerce safety service is unavailable.',
    }, rate === 'limited' ? 429 : 503, rate === 'limited' ? { 'retry-after': '3600' } : {});
  }
  try {
    return commerceJson(await getCommerceReceipt(request, sql, params.receiptId ?? ''));
  } catch (error) {
    const response = commerceErrorResponse(error);
    const headers = new Headers(response.headers);
    Object.entries(commerceCorsHeaders).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  }
};
