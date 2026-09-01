import type { APIRoute } from 'astro';
import { a2aMessageRequestSchema, a2aTaskResponse, executeA2APublicSkill } from '@/lib/a2a';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const publicHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, A2A-Version, A2A-Extensions',
  'access-control-expose-headers': 'A2A-Version',
  'a2a-version': '1.0',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function problem(status: number, type: string, title: string, detail: string, extra: Record<string, unknown> = {}) {
  return Response.json({ type, title, status, detail, ...extra }, {
    status,
    headers: { ...publicHeaders, 'content-type': 'application/problem+json; charset=utf-8' },
  });
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: publicHeaders });

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (params.operation !== 'message:send') {
    return problem(404, 'https://a2a-protocol.org/errors/not-found', 'Operation Not Found', 'This public agent supports POST /message:send only.');
  }

  const requestedVersion = request.headers.get('a2a-version');
  if (requestedVersion && requestedVersion !== '1.0') {
    return problem(
      400,
      'https://a2a-protocol.org/errors/version-not-supported',
      'Protocol Version Not Supported',
      `The requested A2A protocol version ${requestedVersion} is not supported by this agent.`,
      { supportedVersions: ['1.0'] },
    );
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/a2a+json' && contentType !== 'application/json') {
    return problem(415, 'https://a2a-protocol.org/errors/unsupported-media-type', 'Unsupported Media Type', 'Use application/a2a+json.');
  }

  const sql = sqlClient(locals);
  if (!sql) return problem(503, 'https://superii.site/problems/unavailable', 'Service Unavailable', 'Public repository controls are unavailable.');
  const rate = await consumeRateLimit(locals, request, sql, 'a2a.public', 240, 3600);
  if (rate !== 'allowed') {
    return problem(
      rate === 'limited' ? 429 : 503,
      rate === 'limited' ? 'https://superii.site/problems/rate-limited' : 'https://superii.site/problems/unavailable',
      rate === 'limited' ? 'Rate Limit Reached' : 'Service Unavailable',
      rate === 'limited' ? 'The public A2A rate limit has been reached.' : 'The A2A safety service is unavailable.',
    );
  }

  const body = await readBoundedJsonObject(
    request,
    64_000,
    false,
    ['application/a2a+json', 'application/json'],
  );
  if (!body.ok) {
    if (body.status === 413) {
      return problem(413, 'https://a2a-protocol.org/errors/request-too-large', 'Request Too Large', 'A2A requests are limited to 64,000 bytes.');
    }
    return problem(400, 'https://a2a-protocol.org/errors/invalid-request', 'Invalid Request', body.error);
  }
  const parsed = a2aMessageRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return problem(
      400,
      'https://a2a-protocol.org/errors/invalid-request',
      'Invalid Request',
      parsed.error.issues[0]?.message ?? 'The A2A request is invalid.',
    );
  }

  const origin = new URL(request.url).origin;
  const execution = await executeA2APublicSkill(locals, origin, parsed.data.message.parts);
  const response = a2aTaskResponse(execution, parsed.data.message);
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...publicHeaders, 'content-type': 'application/a2a+json; charset=utf-8' },
  });
};
