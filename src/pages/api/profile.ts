import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { parseEditableMemberProfile } from '@/lib/member-profile';
import { consumeRateLimit } from '@/lib/rate-limit';

const privateHeaders = { 'cache-control': 'private, no-store' };

export const PUT: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'profile.update', 30, 3600);
  if (rate !== 'allowed') {
    return Response.json(
      { error: rate === 'limited' ? 'profile update limit reached' : 'safety service unavailable' },
      { status: rate === 'limited' ? 429 : 503, headers: { ...privateHeaders, ...(rate === 'limited' ? { 'retry-after': '3600' } : {}) } },
    );
  }
  const parsed = await readBoundedJsonObject(request, 12_288);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  const input = parseEditableMemberProfile(parsed.value);
  if (!input.ok) return Response.json({ error: input.error }, { status: 422, headers: privateHeaders });
  const value = input.value;
  try {
    const rows = await sql`
      update app.profiles
      set bio = ${value.bio},
          interests = ${JSON.stringify(value.interests)}::jsonb,
          x_username = ${value.x_username},
          github_username = ${value.github_username},
          linkedin_url = ${value.linkedin_url},
          website_url = ${value.website_url},
          youtube_url = ${value.youtube_url},
          updated_at = now()
      where id = ${profile.profileId}::uuid
      returning id, handle, display_name, bio, avatar_url, interests,
                x_username, github_username, linkedin_url, website_url, youtube_url
    `;
    if (!rows.length) return Response.json({ error: 'profile not found' }, { status: 404, headers: privateHeaders });
    return Response.json({ ok: true, profile: rows[0] }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'profile could not be saved' }, { status: 503, headers: privateHeaders });
  }
};
