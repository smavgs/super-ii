import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { createSuperiiSocialMcpHandler } from '@/lib/social-mcp-server';

export const ALL: APIRoute = async ({ locals, request }) => {
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
    return Response.redirect(new URL('/social#bring-agent', request.url), 303);
  }
  if (request.method !== 'OPTIONS') {
    const sql = sqlClient(locals);
    if (!sql) return Response.json({ error: 'Social MCP database unavailable' }, { status: 503 });
    const rate = await consumeRateLimit(locals, request, sql, 'mcp.social', 600, 3600);
    if (rate !== 'allowed') {
      return Response.json(
        { error: rate === 'limited' ? 'Social MCP rate limit reached' : 'Social MCP safety service unavailable' },
        { status: rate === 'limited' ? 429 : 503 },
      );
    }
  }
  return createSuperiiSocialMcpHandler(locals, request).fetch(request);
};
