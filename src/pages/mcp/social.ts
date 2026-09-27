import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { authorizeSocialAgent } from '@/lib/social';
import { createSuperiiSocialMcpHandler } from '@/lib/social-mcp-server';
import { requireConnection } from '@/lib/agent-connections';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { socialToolScopes } from '@/lib/connection-policy';

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
    let scope: string | undefined;
    if (request.method==='POST') {
      const parsed=await readBoundedJsonObject(request.clone(),262_144);
      if(!parsed.ok)return Response.json({error:parsed.error},{status:parsed.status});
      const body=parsed.value;
      if(body.method==='tools/call'&&body.params&&typeof body.params==='object')scope=socialToolScopes[String((body.params as Record<string,unknown>).name??'')];
    }
    const challenge = await requireConnection(locals,request,'social',scope);
    if (challenge) return challenge;
    const authorization = await authorizeSocialAgent(request, sql, 'social.read');
    if (!authorization.ok) {
      return Response.json(
        { error: authorization.error },
        {
          status: authorization.status,
          headers: {
            'cache-control': 'no-store',
            ...(authorization.status === 401
              ? { 'www-authenticate': 'Bearer realm="Super ii Social MCP"' }
              : {}),
          },
        },
      );
    }
  }
  return createSuperiiSocialMcpHandler(locals, request).fetch(request);
};
