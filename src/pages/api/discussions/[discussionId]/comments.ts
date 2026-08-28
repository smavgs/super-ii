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
  const rateLimit = await consumeRateLimit(locals, request, sql, 'discussion.comment', 60, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'comment rate limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503, headers: rateLimit === 'limited' ? { 'retry-after': '3600' } : {} },
    );
  }
  let payload: { body?: unknown; parent_comment_id?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 100_000) : '';
  const parent = typeof payload.parent_comment_id === 'string' ? payload.parent_comment_id : null;
  if (!body) return Response.json({ error: 'comment body is required' }, { status: 422 });
  try {
    const rows = await sql`
      select app.add_discussion_comment(
        ${params.discussionId ?? ''}::uuid,
        ${profile.profileId}::uuid,
        ${parent}::uuid,
        ${body}
      ) as comment_id
    `;
    return Response.json({ ok: true, comment_id: rows[0]?.comment_id }, { status: 201 });
  } catch {
    return Response.json({ error: 'comment could not be created' }, { status: 422 });
  }
};
