import type { APIRoute } from 'astro';
import { authorizeAgentToken } from '@/lib/agent-auth';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals, request, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const authorization = await authorizeAgentToken(request, sql, 'events:read');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const subscriptionId = url.searchParams.get('subscription_id') ?? '';
  const after = Number(url.searchParams.get('after') ?? 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  if (!UUID_PATTERN.test(subscriptionId) || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit)) {
    return Response.json({ error: 'valid subscription_id, non-negative after cursor, and limit are required' }, { status: 422 });
  }
  const subscriptions = await sql`
    select id, target_type, target_id, event_types, acknowledged_cursor
    from app.agent_subscriptions
    where id = ${subscriptionId}::uuid
      and agent_identity_id = ${authorization.actor.agentIdentityId}::uuid
      and enabled
    limit 1
  `;
  const subscription = subscriptions[0];
  if (!subscription?.id) return Response.json({ error: 'enabled subscription not found' }, { status: 404 });
  const eventTypes = Array.isArray(subscription.event_types) ? subscription.event_types as string[] : [];
  const cursor = Math.max(after, Number(subscription.acknowledged_cursor ?? 0));
  const targetType = String(subscription.target_type);
  const targetId = String(subscription.target_id);
  const rows = await sql`
    select cursor, id, organization_id, repository_id, agent_identity_id,
           event_type, visibility, payload, occurred_at
    from app.agent_events
    where cursor > ${cursor}
      and visibility = 'operator'
      and organization_id = ${authorization.actor.organizationId}::uuid
      and (
        (${targetType} = 'organization' and organization_id = ${targetId}::uuid)
        or (${targetType} = 'repository' and repository_id = ${targetId}::uuid)
        or (${targetType} = 'agent' and agent_identity_id = ${targetId}::uuid)
      )
      and (cardinality(${eventTypes}::text[]) = 0 or event_type = any(${eventTypes}::text[]))
    order by cursor asc
    limit ${limit}
  `;
  const nextCursor = rows.length ? Number(rows.at(-1)?.cursor) : cursor;
  await sql`
    update app.agent_identities set last_seen_at = now()
    where id = ${authorization.actor.agentIdentityId}::uuid
  `.catch(() => undefined);
  return Response.json({
    subscription_id: subscriptionId,
    after: cursor,
    next_cursor: nextCursor,
    events: rows,
    delivery: 'poll',
  }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const authorization = await authorizeAgentToken(request, sql, 'events:read');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const subscriptionId = typeof payload.subscription_id === 'string' ? payload.subscription_id : '';
  const cursor = Number(payload.cursor);
  if (!UUID_PATTERN.test(subscriptionId) || !Number.isSafeInteger(cursor) || cursor < 0) {
    return Response.json({ error: 'valid subscription_id and non-negative cursor are required' }, { status: 422 });
  }
  const rows = await sql`
    update app.agent_subscriptions
    set acknowledged_cursor = greatest(acknowledged_cursor, ${cursor})
    where id = ${subscriptionId}::uuid
      and agent_identity_id = ${authorization.actor.agentIdentityId}::uuid
      and enabled
    returning id, acknowledged_cursor
  `;
  if (!rows.length) return Response.json({ error: 'enabled subscription not found' }, { status: 404 });
  return Response.json({ ok: true, subscription: rows[0] });
};
