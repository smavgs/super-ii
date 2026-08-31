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
  const identityId = typeof payload.identity_id === 'string' ? payload.identity_id : '';
  const handle = typeof payload.handle === 'string' ? payload.handle.trim().toLowerCase() : '';
  try {
    const rows = await sql`
      select app.claim_personal_namespace(
        ${profile.profileId}::uuid, ${identityId}::uuid, ${handle}
      ) as claim_id
    `;
    return Response.json({ ok: true, claim_id: rows[0]?.claim_id, handle }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'That namespace is unavailable or does not match the connected identity' }, { status: 409 });
  }
};
