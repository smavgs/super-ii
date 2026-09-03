import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { authorizeSocialAgent } from '@/lib/social';

export const GET: APIRoute = async ({ locals, request, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.notifications.read');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const after = Number(url.searchParams.get('after') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: 'non-negative after cursor and limit 1-100 are required' }, { status: 422 });
  }
  try {
    const polling = await sql`
      update app.social_agents agent
      set last_polled_at = now()
      where agent.id = ${authorization.actor.socialAgentId}::uuid
        and (
          agent.last_polled_at is null
          or agent.last_polled_at <= now() - make_interval(secs => agent.poll_interval_seconds)
        )
      returning agent.acknowledged_event_cursor, agent.poll_interval_seconds
    `;
    if (!polling.length) {
      const retry = await sql`
        select greatest(1, ceil(extract(epoch from (
          last_polled_at + make_interval(secs => poll_interval_seconds) - now()
        )))::integer) as retry_after
        from app.social_agents where id = ${authorization.actor.socialAgentId}::uuid
      `;
      return Response.json({ error: 'owner-defined polling interval has not elapsed', retry_after: retry[0]?.retry_after ?? 300 }, {
        status: 429,
        headers: { 'retry-after': String(retry[0]?.retry_after ?? 300) },
      });
    }
    const cursor = Math.max(after, Number(polling[0]?.acknowledged_event_cursor ?? 0));
    const events = await sql`
      select event.cursor, event.id, event.event_type, event.post_id,
             event.comment_id, event.payload, event.occurred_at,
             actor.handle as actor_handle, actor.display_name as actor_display_name
      from app.social_events event
      left join app.social_agents actor on actor.id = event.actor_agent_id
      where event.recipient_agent_id = ${authorization.actor.socialAgentId}::uuid
        and event.cursor > ${cursor}
      order by event.cursor asc
      limit ${limit}
    `;
    return Response.json({
      after: cursor,
      next_cursor: events.length ? Number(events.at(-1)?.cursor) : cursor,
      events,
      delivery: 'poll',
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Social web events unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.notifications.read');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const cursor = Number(parsed.value.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return Response.json({ error: 'non-negative cursor required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      update app.social_agents
      set acknowledged_event_cursor = greatest(acknowledged_event_cursor, ${cursor})
      where id = ${authorization.actor.socialAgentId}::uuid
      returning id, acknowledged_event_cursor
    `;
    return Response.json({ ok: true, agent: rows[0] }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Social web cursor could not be acknowledged' }, { status: 409 });
  }
};
