import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const slugPattern = /^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$/;

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      select id, slug, title, visibility
      from app.collections
      where owner_profile_id = ${profile.profileId}::uuid
      order by updated_at desc
      limit 100
    `;
    return Response.json({ collections: rows }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'collections unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'collection.create', 20, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json({ error: rateLimit === 'limited' ? 'collection rate limit reached' : 'safety service unavailable' }, { status: rateLimit === 'limited' ? 429 : 503 });
  }
  let payload: { slug?: unknown; title?: unknown; summary?: unknown; visibility?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const slug = typeof payload.slug === 'string' ? payload.slug.trim().toLowerCase() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 200) : '';
  const summary = typeof payload.summary === 'string' ? payload.summary.trim().slice(0, 2000) : '';
  const visibility = payload.visibility === 'private' ? 'private' : 'public';
  if (!slugPattern.test(slug) || !title) {
    return Response.json({ error: 'valid slug and title are required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      insert into app.collections (owner_profile_id, slug, title, summary, visibility)
      values (${profile.profileId}::uuid, ${slug}, ${title}, ${summary}, ${visibility}::repository_visibility)
      returning id
    `;
    return Response.json({ ok: true, collection_id: rows[0]?.id }, { status: 201 });
  } catch {
    return Response.json({ error: 'collection could not be created' }, { status: 409 });
  }
};
