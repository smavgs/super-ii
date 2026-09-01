import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedAgentIdentity, UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const targetTypes = new Set(['organization', 'repository', 'agent']);
const eventTypePattern = /^[a-z][a-z0-9_.-]{1,119}$/;

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  if (!agent) return Response.json({ error: 'agent identity not found or owner/admin access required' }, { status: 404 });
  const rows = await sql`
    select id, target_type, target_id, event_types, delivery,
           acknowledged_cursor, enabled, created_at, updated_at
    from app.agent_subscriptions
    where agent_identity_id = ${agent.id}::uuid
    order by updated_at desc
  `;
  return Response.json({ subscriptions: rows }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  if (!agent) return Response.json({ error: 'agent identity not found or owner/admin access required' }, { status: 404 });
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const targetType = textValue(payload.target_type, 20) || 'organization';
  const targetId = textValue(payload.target_id, 36) || agent.organization_id;
  const rawEvents = Array.isArray(payload.event_types) ? payload.event_types : [];
  const eventTypes = Array.from(new Set(rawEvents.map((value) => textValue(value, 120)).filter(Boolean)));
  const enabled = payload.enabled !== false;
  if (
    !targetTypes.has(targetType) || !UUID_PATTERN.test(targetId)
    || eventTypes.length > 24 || eventTypes.some((eventType) => !eventTypePattern.test(eventType))
  ) {
    return Response.json({ error: 'valid target and up to 24 event types are required' }, { status: 422 });
  }
  let targetAllowed = targetType === 'organization' && targetId === agent.organization_id;
  if (targetType === 'repository') {
    const rows = await sql`
      select exists (
        select 1 from app.repositories
        where id = ${targetId}::uuid and owner_organization_id = ${agent.organization_id}::uuid
      ) as allowed
    `;
    targetAllowed = rows[0]?.allowed === true;
  }
  if (targetType === 'agent') {
    const rows = await sql`
      select exists (
        select 1 from app.agent_identities
        where id = ${targetId}::uuid and organization_id = ${agent.organization_id}::uuid
      ) as allowed
    `;
    targetAllowed = rows[0]?.allowed === true;
  }
  if (!targetAllowed) return Response.json({ error: 'subscription target must belong to the operator organization' }, { status: 403 });
  const rows = await sql`
    insert into app.agent_subscriptions (
      agent_identity_id, created_by_profile_id, target_type, target_id,
      event_types, delivery, enabled
    ) values (
      ${agent.id}::uuid, ${profile.profileId}::uuid, ${targetType},
      ${targetId}::uuid, ${eventTypes}, 'poll', ${enabled}
    )
    on conflict (agent_identity_id, target_type, target_id) do update set
      event_types = excluded.event_types,
      enabled = excluded.enabled,
      created_by_profile_id = excluded.created_by_profile_id
    returning id, target_type, target_id, event_types, delivery,
              acknowledged_cursor, enabled, created_at, updated_at
  `;
  return Response.json({ ok: true, subscription: rows[0] }, { status: 201 });
};
