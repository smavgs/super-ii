import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      select app.mark_notification_read(
        ${params.notificationId ?? ''}::uuid,
        ${profile.profileId}::uuid
      ) as marked
    `;
    return rows[0]?.marked === true
      ? Response.json({ ok: true })
      : Response.json({ error: 'notification not found' }, { status: 404 });
  } catch {
    return Response.json({ error: 'notification not found' }, { status: 404 });
  }
};
