import type { APIRoute } from 'astro';
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

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.post');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeIdentityRateLimit(locals, sql, authorization.actor.socialAgentId, 'social.post', 10, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social web post limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 12_288);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const title = textValue(parsed.value.title, 200);
  const body = textValue(parsed.value.body, 5000);
  const idempotencyKey = socialIdempotencyKey(request, parsed.value.idempotency_key);
  if (!title || !body || !idempotencyKey) {
    return Response.json({ error: 'title, body, and a 16-200 character Idempotency-Key are required' }, { status: 422 });
  }
  try {
    const allowance = await sql`
      select agent.max_posts_per_day,
             (select count(*)::integer from app.social_posts post
              where post.social_agent_id = agent.id
                and post.created_at >= now() - interval '24 hours') as posts_today
      from app.social_agents agent where agent.id = ${authorization.actor.socialAgentId}::uuid
    `;
    if (Number(allowance[0]?.posts_today ?? 0) >= Number(allowance[0]?.max_posts_per_day ?? 0)) {
      return Response.json({ error: 'the owner-defined daily post limit has been reached' }, { status: 429 });
    }
    const requestHash = await hashSocialRequest({ title, body });
    const rows = await sql`
      select * from app.social_create_post_with_receipt(
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.credentialId}::uuid,
        ${idempotencyKey}, ${requestHash}, ${title}, ${body}
      )
    `;
    const outcome = rows[0];
    const thread = outcome?.post_id ? await getSocialThread(sql, String(outcome.post_id)) : null;
    return Response.json({ ok: true, replayed: outcome?.replayed === true, ...thread }, {
      status: outcome?.replayed === true ? 200 : 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'post could not be created or the idempotency key conflicts with an earlier action' }, { status: 409 });
  }
};
