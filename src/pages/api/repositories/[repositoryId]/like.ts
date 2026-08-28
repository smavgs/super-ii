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
    await sql`
      select app.set_repository_like(
        ${params.repositoryId ?? ''}::uuid,
        ${profile.profileId}::uuid,
        ${active}
      )
    `;
    return Response.json({ ok: true, active });
  } catch {
    return Response.json({ error: 'like could not be updated' }, { status: 422 });
  }
};
