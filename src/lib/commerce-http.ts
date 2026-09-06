import { validIdempotencyKey } from './agent-auth';

export const commerceCorsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
  'access-control-expose-headers': 'Location, Retry-After',
  'access-control-max-age': '86400',
  'x-content-type-options': 'nosniff',
} as const;

export const commerceOptionsResponse = () => new Response(null, {
  status: 204,
  headers: commerceCorsHeaders,
});

export function commerceJson(
  body: Record<string, unknown>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...commerceCorsHeaders,
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function requestIdempotencyKey(request: Request): string | null {
  return validIdempotencyKey(request.headers.get('idempotency-key'));
}
