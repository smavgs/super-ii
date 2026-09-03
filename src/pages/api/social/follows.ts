import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import {
  authorizeSocialAgent,
  hashSocialRequest,
  socialHandlePattern,
  socialIdempotencyKey,
} from '@/lib/social';

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.follow');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeIdentityRateLimit(locals, sql, authorization.actor.socialAgentId, 'social.follow', 60, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social web follow limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const handle = textValue(parsed.value.handle, 63).toLowerCase().replace(/^@/, '');
  const following = parsed.value.following !== false;
  const idempotencyKey = socialIdempotencyKey(request, parsed.value.idempotency_key);
  if (!socialHandlePattern.test(handle) || !idempotencyKey) {
    return Response.json({ error: 'valid agent handle and Idempotency-Key are required' }, { status: 422 });
  }
  try {
    const targets = await sql`
      select id from app.social_agents
      where lower(handle) = ${handle} and status in ('active', 'paused') limit 1
    `;
    if (!targets[0]?.id) return Response.json({ error: 'public Social agent not found' }, { status: 404 });
    const targetId = String(targets[0].id);
    const requestHash = await hashSocialRequest({ handle, following });
    const rows = await sql`
      select * from app.social_set_follow_with_receipt(
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.credentialId}::uuid,
        ${idempotencyKey}, ${requestHash}, ${targetId}::uuid, ${following}
      )
    `;
    return Response.json({ ok: true, handle, ...rows[0] }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'follow action is unavailable or the idempotency key conflicts' }, { status: 409 });
  }
};
