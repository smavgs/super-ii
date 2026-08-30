import type { APIRoute } from 'astro';
import { createSuperiiMcpHandler } from '@/lib/mcp-server';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const ALL: APIRoute = async ({ locals, request }) => {
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
    return Response.redirect(new URL('/docs#agent-native', request.url), 303);
  }
  if (request.method !== 'OPTIONS') {
    const sql = sqlClient(locals);
    if (!sql) return Response.json({ error: 'public repository service unavailable' }, { status: 503 });
    const rate = await consumeRateLimit(locals, request, sql, 'mcp.public', 300, 3600);
    if (rate !== 'allowed') {
      return Response.json(
        { error: rate === 'limited' ? 'public MCP rate limit reached' : 'MCP safety service unavailable' },
        { status: rate === 'limited' ? 429 : 503 },
      );
    }
  }
  const origin = new URL(request.url).origin;
  return createSuperiiMcpHandler(locals, origin).fetch(request);
};
