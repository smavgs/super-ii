import type { APIRoute } from 'astro';
import { createSuperiiRobotMcpHandler } from '@/lib/robot-mcp-server';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const ALL: APIRoute = async ({ locals, request }) => {
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) return Response.redirect(new URL('/robot#agents', request.url), 303);
  if (request.method !== 'OPTIONS') {
    const sql = sqlClient(locals);
    if (!sql) return Response.json({ error: 'Robot MCP safety controls unavailable' }, { status: 503 });
    const rate = await consumeRateLimit(locals, request, sql, 'mcp.robot', 600, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Robot MCP rate limit reached' : 'Robot MCP safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  }
  const origin = new URL(request.url).origin;
  return createSuperiiRobotMcpHandler(locals, origin).fetch(request);
};
