import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  let active: unknown;
  try {
    const payload = await request.json() as { active?: unknown };
    active = payload.active;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof active !== 'boolean') return Response.json({ error: 'active must be boolean' }, { status: 422 });
  try {
    const rows = await sql`
      select app.set_profile_follow(
        ${profile.profileId}::uuid,
        ${params.profileId ?? ''}::uuid,
        ${active}
      ) as active
      where exists (
        select 1 from app.profiles
        where id = ${params.profileId ?? ''}::uuid and is_public
      )
    `;
    if (!rows.length) return Response.json({ error: 'profile not found' }, { status: 404 });
    return Response.json({ ok: true, active: rows[0]?.active });
  } catch {
    return Response.json({ error: 'follow could not be updated' }, { status: 422 });
  }
};
