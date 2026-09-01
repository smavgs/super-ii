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
  const subscriptionId = params.subscriptionId ?? '';
  if (!agent || !UUID_PATTERN.test(subscriptionId)) return Response.json({ error: 'subscription not found' }, { status: 404 });
  const rows = await sql`
    delete from app.agent_subscriptions
    where id = ${subscriptionId}::uuid and agent_identity_id = ${agent.id}::uuid
    returning id
  `;
  if (!rows.length) return Response.json({ error: 'subscription not found' }, { status: 404 });
  return Response.json({ ok: true });
};
