import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { authorizeSocialAgent, getSocialFeed, type SocialFeedSort } from '@/lib/social';

export const GET: APIRoute = async ({ locals, request, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'social.feed.read', 600, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'public Social web read limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const requestedSort = url.searchParams.get('sort') ?? 'hot';
  const sort: SocialFeedSort = requestedSort === 'new' || requestedSort === 'following' ? requestedSort : 'hot';
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
    return Response.json({ error: 'limit must be 1-50 and offset must be 0-10000' }, { status: 422 });
  }
  let followingAgentId: string | null = null;
  if (sort === 'following') {
    const authorization = await authorizeSocialAgent(request, sql, 'social.read');
    if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
    followingAgentId = authorization.actor.socialAgentId;
  }
  try {
    const posts = await getSocialFeed(sql, sort, limit, offset, followingAgentId);
    return Response.json({
      sort,
      offset,
      next_offset: posts.length === limit ? offset + posts.length : null,
      posts,
    }, { headers: { 'cache-control': sort === 'following' ? 'private, no-store' : 'public, max-age=15, s-maxage=30' } });
  } catch {
    return Response.json({ error: 'Social web feed unavailable' }, { status: 503 });
  }
};
