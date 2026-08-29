import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { repositorySlugPattern, optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const relationshipTypes = new Set(['introduces', 'trains', 'evaluates', 'references', 'reproduces']);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'paper.publish', 20, 86400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'paper publishing limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const slug = textValue(body.slug, 96).toLowerCase();
  const title = textValue(body.title, 300);
  const abstract = textValue(body.abstract, 20_000);
  const canonicalUrl = optionalUrl(body.canonical_url);
  const doi = textValue(body.doi, 300) || null;
  const publishedOn = textValue(body.published_on, 10) || null;
  if (!repositorySlugPattern.test(slug) || title.length < 3 || abstract.length < 10) {
    return Response.json({ error: 'slug, title, and abstract are required' }, { status: 400 });
  }
  if (body.canonical_url && !canonicalUrl) return Response.json({ error: 'canonical URL must use HTTPS' }, { status: 400 });
  if (publishedOn && Number.isNaN(Date.parse(publishedOn))) return Response.json({ error: 'invalid publication date' }, { status: 400 });
  const links = Array.isArray(body.repository_links) ? body.repository_links.slice(0, 50) : [];
  try {
    const rows = await sql`
      insert into app.papers (owner_profile_id, slug, title, abstract, canonical_url, doi, published_on)
      values (${profile.profileId}::uuid, ${slug}, ${title}, ${abstract}, ${canonicalUrl}, ${doi}, ${publishedOn}::date)
      returning id
    `;
    const paperId = String(rows[0].id);
    for (const value of links) {
      if (!value || typeof value !== 'object') continue;
      const repositoryId = textValue((value as Record<string, unknown>).repository_id, 40);
      const relationshipType = textValue((value as Record<string, unknown>).relationship_type, 30);
      if (!/^[0-9a-f-]{36}$/i.test(repositoryId) || !relationshipTypes.has(relationshipType)) continue;
      await sql`
        insert into app.paper_repository_links (paper_id, repository_id, relationship_type)
        select ${paperId}::uuid, r.id, ${relationshipType}
        from app.repositories r
        where r.id = ${repositoryId}::uuid and r.visibility = 'public' and r.status = 'published'
        on conflict do nothing
      `;
    }
    await sql`insert into app.activity_events (actor_profile_id, event_type, metadata) values (${profile.profileId}::uuid, 'paper.published', jsonb_build_object('paper_id', ${paperId}::uuid, 'slug', ${slug}, 'title', ${title}))`;
    const handles = await sql`select handle from app.profiles where id = ${profile.profileId}::uuid`;
    return Response.json({ href: `/papers/${handles[0].handle}/${slug}` }, { status: 201 });
  } catch {
    return Response.json({ error: 'paper could not be published; the slug may already exist' }, { status: 409 });
  }
};
