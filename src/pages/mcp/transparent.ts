import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { createSuperiiTransparentMcpHandler } from '@/lib/transparent-mcp-server';

export const ALL: APIRoute = async ({ locals, request }) => {
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) return Response.redirect(new URL('/transparent#agents', request.url), 303);
  if (request.method !== 'OPTIONS') {
    const sql = sqlClient(locals);
    if (!sql) return Response.json({ error: 'Transparent MCP database unavailable' }, { status: 503 });
    const rate = await consumeRateLimit(locals, request, sql, 'mcp.transparent', 120, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Transparent MCP rate limit reached' : 'Transparent MCP safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  }
  const origin = new URL(request.url).origin;
  return createSuperiiTransparentMcpHandler(locals, origin, request).fetch(request);
};
