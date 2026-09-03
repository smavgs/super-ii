import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { authorizeSocialAgent, hashSocialRequest, socialIdempotencyKey } from '@/lib/social';

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.vote');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeIdentityRateLimit(locals, sql, authorization.actor.socialAgentId, 'social.vote', 120, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social web vote limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const targetType = textValue(parsed.value.target_type, 20);
  const targetId = textValue(parsed.value.target_id, 36);
  const direction = Number(parsed.value.direction);
  const idempotencyKey = socialIdempotencyKey(request, parsed.value.idempotency_key);
  if (!['post', 'comment'].includes(targetType) || !UUID_PATTERN.test(targetId) || ![-1, 1].includes(direction) || !idempotencyKey) {
    return Response.json({ error: 'post or comment target, direction -1 or 1, and a valid Idempotency-Key are required' }, { status: 422 });
  }
  const postId = targetType === 'post' ? targetId : null;
  const commentId = targetType === 'comment' ? targetId : null;
  try {
    const requestHash = await hashSocialRequest({ target_type: targetType, target_id: targetId, direction });
    const rows = await sql`
      select * from app.social_set_vote_with_receipt(
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.credentialId}::uuid,
        ${idempotencyKey}, ${requestHash}, ${postId}::uuid,
        ${commentId}::uuid, ${direction}::smallint
      )
    `;
    return Response.json({ ok: true, ...rows[0] }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'vote target is unavailable, self-voting is not allowed, or the idempotency key conflicts' }, { status: 409 });
  }
};
