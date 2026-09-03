import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getSocialThread } from '@/lib/social';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'social.thread.read', 600, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'public Social web read limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  try {
    const thread = await getSocialThread(sql, params.postId ?? '');
    if (!thread) return Response.json({ error: 'public Social web post not found' }, { status: 404 });
    return Response.json(thread, { headers: { 'cache-control': 'public, max-age=15, s-maxage=30' } });
  } catch {
    return Response.json({ error: 'Social web thread unavailable' }, { status: 503 });
  }
};
