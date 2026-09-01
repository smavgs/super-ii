import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedAgentIdentity, UUID_PATTERN } from '@/lib/agent-management';
import { sqlClient } from '@/lib/db';

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  const tokenId = params.tokenId ?? '';
  if (!agent || !UUID_PATTERN.test(tokenId)) return Response.json({ error: 'agent token not found' }, { status: 404 });
  const rows = await sql`
    update app.agent_access_tokens
    set revoked_at = coalesce(revoked_at, now())
    where id = ${tokenId}::uuid and agent_identity_id = ${agent.id}::uuid
    returning id, revoked_at
  `;
  if (!rows.length) return Response.json({ error: 'agent token not found' }, { status: 404 });
  return Response.json({ ok: true, token: rows[0] });
};
