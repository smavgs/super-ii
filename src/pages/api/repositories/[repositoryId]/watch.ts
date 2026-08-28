import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

const levels = new Set(['off', 'all', 'releases', 'discussions']);

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  let level: unknown;
  try {
    const payload = await request.json() as { level?: unknown };
    level = payload.level;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof level !== 'string' || !levels.has(level)) {
    return Response.json({ error: 'invalid watch level' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select app.set_repository_watch(
        ${params.repositoryId ?? ''}::uuid,
        ${profile.profileId}::uuid,
        ${level}
      ) as level
    `;
    return Response.json({ ok: true, level: rows[0]?.level });
  } catch {
    return Response.json({ error: 'watch setting could not be updated' }, { status: 422 });
  }
};
