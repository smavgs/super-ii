import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const delegationId = params.delegationId ?? '';
  if (!UUID_PATTERN.test(delegationId)) {
    return Response.json({ error: 'commerce delegation not found' }, { status: 404, headers: privateHeaders });
  }
  try {
    const rows = await sql`
      update app.commerce_delegations
      set revoked_at = coalesce(revoked_at, now()), updated_at = now()
      where id = ${delegationId}::uuid
        and profile_id = ${profile.profileId}::uuid
      returning id, token_prefix, revoked_at
    `;
    if (!rows.length) return Response.json({ error: 'commerce delegation not found' }, { status: 404, headers: privateHeaders });
    return Response.json({ ok: true, delegation: rows[0] }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'commerce delegation could not be revoked' }, { status: 503, headers: privateHeaders });
  }
};
