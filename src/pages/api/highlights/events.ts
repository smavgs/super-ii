import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit, requestNetworkHash } from '@/lib/rate-limit';

const eventTypes = new Set(['impression', 'profile_view', 'repository_open', 'download']);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'highlight service unavailable' }, { status: 503 });
  const [rate, visitorHash] = await Promise.all([
    consumeRateLimit(locals, request, sql, 'highlight.event', 1000, 3600),
    requestNetworkHash(locals, request, 'highlight-visitor'),
  ]);
  if (rate !== 'allowed' || !visitorHash) {
    return Response.json({ error: rate === 'limited' ? 'event limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 2048);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const campaignId = textValue(parsed.value.campaign_id, 36);
  const eventType = textValue(parsed.value.event_type, 24);
  if (!UUID_PATTERN.test(campaignId) || !eventTypes.has(eventType)) {
    return Response.json({ error: 'valid campaign and event required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select app.record_highlight_event(
        ${campaignId}::uuid, ${eventType}, ${visitorHash}
      ) as recorded
    `;
    return Response.json({ ok: true, recorded: rows[0]?.recorded === true }, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'highlight event could not be recorded' }, { status: 409 });
  }
};
