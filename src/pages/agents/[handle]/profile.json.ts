import type { APIRoute } from 'astro';
import { getPublicAgentProfile, publicAgentDocument } from '@/lib/agent-profile';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'public agent service unavailable' }, { status: 503 });
  try {
    const profile = await getPublicAgentProfile(sql, params.handle ?? '');
    if (!profile) return Response.json({ error: 'public agent not found' }, { status: 404 });
    return Response.json(publicAgentDocument(profile, new URL(request.url).origin), {
      headers: { 'cache-control': 'public, max-age=60, s-maxage=300', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return Response.json({ error: 'public agent service unavailable' }, { status: 503 });
  }
};
