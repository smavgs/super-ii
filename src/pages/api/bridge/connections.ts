import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const connections = await sql`
    select id, provider, provider_username, display_name, avatar_url, scopes,
           organizations, token_expires_at, last_verified_at, created_at
    from app.external_identities
    where profile_id = ${profile.profileId}::uuid and revoked_at is null
    order by provider, created_at
  `;
  return Response.json({ connections }, { headers: { 'cache-control': 'private, no-store' } });
};

export const DELETE: APIRoute = async ({ locals, request }) => {
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
  if (!/^[a-f0-9-]{36}$/i.test(identityId)) return Response.json({ error: 'connection not found' }, { status: 404 });
  try {
    const rows = await sql`
      update app.external_identities
      set revoked_at = now(), access_token_ciphertext = null,
          access_token_nonce = null, token_expires_at = null, updated_at = now()
      where id = ${identityId}::uuid and profile_id = ${profile.profileId}::uuid and revoked_at is null
      returning id
    `;
    if (!rows[0]) return Response.json({ error: 'connection not found' }, { status: 404 });
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'connection could not be removed' }, { status: 503 });
  }
};
