import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { repositorySlugPattern, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'post.publish', 30, 86400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'post publishing limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const slug = textValue(input.slug, 96).toLowerCase();
  const title = textValue(input.title, 300);
  const summary = textValue(input.summary, 2000);
  const body = textValue(input.body, 100_000);
  if (!repositorySlugPattern.test(slug) || title.length < 3 || !body) {
    return Response.json({ error: 'slug, title, and body are required' }, { status: 400 });
  }
  try {
    const rows = await sql`
      insert into app.posts (author_profile_id, slug, title, summary, body)
      values (${profile.profileId}::uuid, ${slug}, ${title}, ${summary}, ${body})
      returning id
    `;
    const postId = String(rows[0].id);
    await sql`insert into app.activity_events (actor_profile_id, event_type, metadata) values (${profile.profileId}::uuid, 'post.published', jsonb_build_object('post_id', ${postId}::uuid, 'slug', ${slug}, 'title', ${title}))`;
    const handles = await sql`select handle from app.profiles where id = ${profile.profileId}::uuid`;
    return Response.json({ href: `/posts/${handles[0].handle}/${slug}` }, { status: 201 });
  } catch {
    return Response.json({ error: 'post could not be published; the slug may already exist' }, { status: 409 });
  }
};
