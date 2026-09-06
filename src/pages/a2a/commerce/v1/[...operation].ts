import type { APIRoute } from 'astro';
import { a2aMessageRequestSchema, a2aTaskResponse } from '@/lib/a2a';
import { executeCommerceA2ASkill } from '@/lib/commerce-a2a';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, A2A-Version, A2A-Extensions',
  'access-control-expose-headers': 'A2A-Version',
  'a2a-version': '1.0',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function problem(status: number, title: string, detail: string) {
  return Response.json({ type: 'https://superii.site/problems/commerce-a2a', title, status, detail }, {
    status,
    headers: { ...headers, 'content-type': 'application/problem+json; charset=utf-8' },
  });
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers });

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (params.operation !== 'message:send') return problem(404, 'Operation Not Found', 'Use POST /a2a/commerce/v1/message:send.');
  const requestedVersion = request.headers.get('a2a-version');
  if (requestedVersion && requestedVersion !== '1.0') return problem(400, 'Protocol Version Not Supported', 'This agent supports A2A version 1.0.');
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/a2a+json' && contentType !== 'application/json') {
    return problem(415, 'Unsupported Media Type', 'Use application/a2a+json.');
  }
  const sql = sqlClient(locals);
  if (!sql) return problem(503, 'Service Unavailable', 'Commerce controls are unavailable.');
  const rate = await consumeRateLimit(locals, request, sql, 'a2a.commerce', 240, 3600);
  if (rate !== 'allowed') {
    return problem(rate === 'limited' ? 429 : 503, rate === 'limited' ? 'Rate Limit Reached' : 'Service Unavailable', rate === 'limited' ? 'Commerce A2A rate limit reached.' : 'Commerce safety service unavailable.');
  }
  const body = await readBoundedJsonObject(request, 64_000, false, ['application/a2a+json', 'application/json']);
  if (!body.ok) return problem(body.status === 413 ? 413 : 400, body.status === 413 ? 'Request Too Large' : 'Invalid Request', body.error);
  const parsed = a2aMessageRequestSchema.safeParse(body.value);
  if (!parsed.success) return problem(400, 'Invalid Request', parsed.error.issues[0]?.message ?? 'Invalid A2A request.');
  const origin = new URL(request.url).origin;
  const execution = await executeCommerceA2ASkill(locals, origin, request, parsed.data.message.parts);
  const response = a2aTaskResponse(execution, parsed.data.message, {
    artifactDescription: 'Bounded Super ii commerce result. Order creation makes an invoice only and does not transfer funds.',
    artifactMetadata: { commerce: true, walletCustody: 'external', paymentRailOperatedBySuperii: false },
    taskMetadata: { skillId: execution.ok ? execution.skillId : null, commerce: true, authenticated: request.headers.has('authorization') },
  });
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...headers, 'content-type': 'application/a2a+json; charset=utf-8' },
  });
};
