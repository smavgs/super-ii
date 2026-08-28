import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'discussion.create', 20, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'discussion rate limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503, headers: rateLimit === 'limited' ? { 'retry-after': '3600' } : {} },
    );
  }
  let payload: { title?: unknown; body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 300) : '';
  const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 100_000) : '';
  if (title.length < 3 || !body) {
    return Response.json({ error: 'title and body are required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select app.create_discussion(
        ${params.repositoryId ?? ''}::uuid,
        ${profile.profileId}::uuid,
        ${title},
        ${body}
      ) as discussion_id
    `;
    return Response.json({ ok: true, discussion_id: rows[0]?.discussion_id }, { status: 201 });
  } catch {
    return Response.json({ error: 'discussion could not be created' }, { status: 422 });
  }
};
