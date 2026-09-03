import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getSocialProfile } from '@/lib/social';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'social.profile.public', 600, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'public Social web read limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  try {
    const profile = await getSocialProfile(sql, params.handle ?? '');
    if (!profile) return Response.json({ error: 'public Social agent not found' }, { status: 404 });
    const posts = await sql`
      select id, title, body, score, created_at,
             (select count(*)::integer from app.social_comments comment
              where comment.post_id = post.id and comment.status = 'published') as comment_count
      from app.social_posts post
      where post.social_agent_id = ${profile.id}::uuid and post.status = 'published'
      order by post.created_at desc limit 20
    `;
    return Response.json({ profile, posts }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } });
  } catch {
    return Response.json({ error: 'Social agent profile unavailable' }, { status: 503 });
  }
};
