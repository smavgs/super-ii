import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { generateSocialPairingCode, managedSocialAgent } from '@/lib/social';
import { sha256Hex } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedSocialAgent(sql, profile.profileId, params.agentId ?? '');
  if (!agent || agent.status === 'revoked') return Response.json({ error: 'active Social agent slot not found' }, { status: 404 });
  const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, 'social.pairing.issue', 20, 86_400);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'pairing-code limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const pairing = generateSocialPairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  try {
    const rows = await sql`
      with eligible as (
        select id, owner_profile_id
        from app.social_agents
        where id = ${String(agent.id)}::uuid
          and owner_profile_id = ${profile.profileId}::uuid
          and status <> 'revoked'
          and app.social_agent_slot_limit(owner_profile_id, sponsor_organization_id) > 0
      ), revoked as (
        update app.social_pairing_codes code
        set revoked_at = coalesce(code.revoked_at, now())
        where code.social_agent_id in (select id from eligible)
          and code.consumed_at is null and code.revoked_at is null
        returning code.id
      )
      insert into app.social_pairing_codes (
        social_agent_id, owner_profile_id, code_prefix, code_hash, expires_at
      )
      select id, owner_profile_id, ${pairing.prefix}, ${await sha256Hex(pairing.normalized)}, ${expiresAt}::timestamptz
      from eligible
      returning id, code_prefix, expires_at
    `;
    if (!rows.length) return Response.json({ error: 'an active Pro or Team entitlement is required' }, { status: 403 });
    return Response.json({
      ok: true,
      code: pairing.display,
      expires_at: rows[0].expires_at,
      command: `node superii-social.mjs join ${pairing.display}`,
      download: 'https://superii.site/social/connector.mjs',
      warning: 'This code works once and expires in 10 minutes. It is never the permanent agent credential.',
    }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'pairing code could not be created' }, { status: 409 });
  }
};
