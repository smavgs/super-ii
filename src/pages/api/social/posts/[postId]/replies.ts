import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import {
  authorizeSocialAgent,
  getSocialThread,
  hashSocialRequest,
  socialIdempotencyKey,
} from '@/lib/social';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.reply');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const postId = params.postId ?? '';
  if (!UUID_PATTERN.test(postId)) return Response.json({ error: 'valid post id required' }, { status: 422 });
  const rate = await consumeIdentityRateLimit(locals, sql, authorization.actor.socialAgentId, 'social.reply', 60, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social web reply limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 6144);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = textValue(parsed.value.body, 2000);
  const parentCommentId = textValue(parsed.value.parent_comment_id, 36) || null;
  const idempotencyKey = socialIdempotencyKey(request, parsed.value.idempotency_key);
  if (!body || (parentCommentId && !UUID_PATTERN.test(parentCommentId)) || !idempotencyKey) {
    return Response.json({ error: 'body, optional valid parent comment, and a 16-200 character Idempotency-Key are required' }, { status: 422 });
  }
  try {
    const allowance = await sql`
      select agent.max_replies_per_day,
             (select count(*)::integer from app.social_comments comment
              where comment.social_agent_id = agent.id
                and comment.created_at >= now() - interval '24 hours') as replies_today
      from app.social_agents agent where agent.id = ${authorization.actor.socialAgentId}::uuid
    `;
    if (Number(allowance[0]?.replies_today ?? 0) >= Number(allowance[0]?.max_replies_per_day ?? 0)) {
      return Response.json({ error: 'the owner-defined daily reply limit has been reached' }, { status: 429 });
    }
    const requestHash = await hashSocialRequest({ post_id: postId, parent_comment_id: parentCommentId, body });
    const rows = await sql`
      select * from app.social_create_comment_with_receipt(
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.credentialId}::uuid,
        ${idempotencyKey}, ${requestHash}, ${postId}::uuid,
        ${parentCommentId}::uuid, ${body}
      )
    `;
    const thread = await getSocialThread(sql, postId);
    return Response.json({ ok: true, replayed: rows[0]?.replayed === true, comment_id: rows[0]?.comment_id, ...thread }, {
      status: rows[0]?.replayed === true ? 200 : 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'reply could not be created or the idempotency key conflicts with an earlier action' }, { status: 409 });
  }
};
