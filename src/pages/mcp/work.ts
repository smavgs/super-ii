import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { createSuperiiWorkMcpHandler } from '@/lib/work-mcp-server';
import { requireConnection } from '@/lib/agent-connections';
import { workToolScopes } from '@/lib/connection-policy';

export const ALL: APIRoute = async ({ locals, request }) => {
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
    return Response.redirect(new URL('/agents#work-lane', request.url), 303);
  }
  if (request.method !== 'OPTIONS') {
    const sql = sqlClient(locals);
    if (!sql) return Response.json({ error: 'Work MCP database unavailable' }, { status: 503 });
    const rate = await consumeRateLimit(locals, request, sql, 'mcp.work', 600, 3600);
    if (rate !== 'allowed') {
      return Response.json(
        { error: rate === 'limited' ? 'Work MCP rate limit reached' : 'Work MCP safety service unavailable' },
        { status: rate === 'limited' ? 429 : 503 },
      );
    }
    let scope: string | undefined;
    if (request.method === 'POST') {
      try { const parsed = await readBoundedJsonObject(request.clone(), 262_144); if (!parsed.ok) return Response.json({error:parsed.error},{status:parsed.status}); const body=parsed.value; if (body.method === 'tools/call' && body.params && typeof body.params==='object') scope = workToolScopes[String((body.params as Record<string,unknown>).name ?? '')]; } catch { /* MCP validates the body. */ }
    }
    const challenge = await requireConnection(locals,request,'work',scope);
    if (challenge) return challenge;

  }
  const origin = new URL(request.url).origin;
  return createSuperiiWorkMcpHandler(locals, origin, request).fetch(request);
};
