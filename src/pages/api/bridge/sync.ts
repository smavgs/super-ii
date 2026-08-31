import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const repositoryId = typeof payload.repository_id === 'string' ? payload.repository_id : '';
  try {
    const rows = await sql`
      select app.set_bridge_sync(
        ${profile.profileId}::uuid, ${repositoryId}::uuid, ${payload.enabled === true}
      ) as subscription_id
    `;
    return Response.json({ ok: true, subscription_id: rows[0]?.subscription_id, enabled: payload.enabled === true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Sync could not be changed for this repository' }, { status: 409 });
  }
};
