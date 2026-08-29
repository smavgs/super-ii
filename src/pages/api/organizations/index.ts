import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const handlePattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const usernamePattern = /^[a-zA-Z0-9_-]{1,100}$/;
const types = new Set(['company', 'university', 'classroom', 'non-profit', 'government', 'community']);

export const GET: APIRoute = async ({ locals, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const mine = url.searchParams.get('mine') === '1';
  try {
    if (mine) {
      const profile = await ensureAuthenticatedProfile(locals, sql);
      if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
      const rows = await sql`
        select o.id, o.handle, o.name, o.full_name, o.organization_type, m.role
        from app.organizations o
        join app.organization_members m on m.organization_id = o.id
        where m.profile_id = ${profile.profileId}::uuid
        order by o.updated_at desc
        limit 100
      `;
      return Response.json({ organizations: rows }, { headers: { 'cache-control': 'private, no-store' } });
    }
    const rows = await sql`
      select o.id, o.handle, o.name, o.full_name, o.organization_type,
             o.logo_url, o.description, o.updated_at,
             count(distinct m.profile_id)::integer as member_count,
             count(distinct r.id)::integer as repository_count
      from app.organizations o
      left join app.organization_members m on m.organization_id = o.id
      left join app.repositories r on r.owner_organization_id = o.id
        and r.visibility = 'public' and r.status = 'published'
      where o.is_public
      group by o.id
      order by o.updated_at desc
      limit 100
    `;
    return Response.json({ organizations: rows }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch {
    return Response.json({ error: 'organizations unavailable' }, { status: 503 });
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'organization.create', 10, 86400);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'organization creation limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503 },
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const handle = textValue(payload.handle, 40).toLowerCase();
  const organizationType = textValue(payload.organization_type, 40);
  const fullName = textValue(payload.full_name, 200);
  const homepageUrl = optionalUrl(payload.homepage_url);
  const logoUrl = optionalUrl(payload.logo_url);
  const githubUsername = textValue(payload.github_username, 100).replace(/^@/, '');
  const twitterUsername = textValue(payload.twitter_username, 100).replace(/^@/, '');
  const linkedinUrl = optionalUrl(payload.linkedin_url);
  const rawInterests = Array.isArray(payload.ai_ml_interests)
    ? payload.ai_ml_interests
    : textValue(payload.ai_ml_interests, 2000).split(',');
  const interests = rawInterests
    .map((value) => textValue(value, 80))
    .filter(Boolean)
    .slice(0, 20);

  if (!handlePattern.test(handle) || !types.has(organizationType) || fullName.length < 2) {
    return Response.json({ error: 'valid username, organization type, and full name are required' }, { status: 422 });
  }
  if ((payload.homepage_url && !homepageUrl) || (payload.logo_url && !logoUrl) || (payload.linkedin_url && !linkedinUrl)) {
    return Response.json({ error: 'website, logo, and LinkedIn URLs must use HTTPS' }, { status: 422 });
  }
  if ((githubUsername && !usernamePattern.test(githubUsername)) || (twitterUsername && !usernamePattern.test(twitterUsername))) {
    return Response.json({ error: 'GitHub and X usernames contain unsupported characters' }, { status: 422 });
  }

  try {
    const rows = await sql`
      select app.create_organization(
        ${profile.profileId}::uuid,
        ${handle},
        ${organizationType},
        ${fullName},
        ${homepageUrl},
        ${logoUrl},
        ${githubUsername || null},
        ${twitterUsername || null},
        ${linkedinUrl},
        ${JSON.stringify(interests)}::jsonb
      ) as organization_id
    `;
    return Response.json(
      { ok: true, organization_id: rows[0]?.organization_id, href: `/organizations/${handle}` },
      { status: 201 },
    );
  } catch {
    return Response.json({ error: 'organization username is unavailable or the profile is invalid' }, { status: 409 });
  }
};
