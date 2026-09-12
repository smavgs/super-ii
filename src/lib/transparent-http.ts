import { TransparencyError } from './transparent';

export const publicTransparencyHeaders = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=60, s-maxage=300',
  'x-content-type-options': 'nosniff',
} as const;

export const privateTransparencyHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
} as const;

export function transparencyErrorResponse(error: unknown, headers: Record<string, string> = privateTransparencyHeaders): Response {
  if (error instanceof TransparencyError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
  }
  return Response.json({ error: 'Transparency Check is temporarily unavailable.', code: 'checker_unavailable' }, { status: 503, headers });
}

export function transparencyOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
      'access-control-max-age': '86400',
    },
  });
}
