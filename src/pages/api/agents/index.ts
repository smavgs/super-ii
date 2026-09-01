import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { AGENT_HANDLE_PATTERN, FRAMEWORK_PATTERN, UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      select identity.id, identity.organization_id, identity.handle,
             identity.display_name, identity.description, identity.framework,
             identity.agent_card_url, identity.is_public, identity.status,
             identity.verified_at, identity.last_seen_at, identity.created_at,
             organization.handle as organization_handle,
             coalesce(organization.full_name, organization.name) as organization_name,
             member.role as operator_role,
             coalesce(reputation.reputation_score, 0)::integer as reputation_score,
             count(distinct token.id)::integer as token_count,
             count(distinct token.id) filter (
               where token.revoked_at is null and token.expires_at > now()
             )::integer as active_token_count
      from app.agent_identities identity
      join app.organizations organization on organization.id = identity.organization_id
      join app.organization_members member on member.organization_id = identity.organization_id
      left join app.agent_reputation reputation on reputation.agent_identity_id = identity.id
      left join app.agent_access_tokens token on token.agent_identity_id = identity.id
      where member.profile_id = ${profile.profileId}::uuid
        and member.role in ('owner', 'admin')
      group by identity.id, organization.id, member.role, reputation.reputation_score
      order by identity.updated_at desc
      limit 100
    `;
    return Response.json({ agents: rows }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'agent identities unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'agent.identity.create', 20, 86400);
  if (rate !== 'allowed') {
    return Response.json(
      { error: rate === 'limited' ? 'agent identity creation limit reached' : 'safety service unavailable' },
      { status: rate === 'limited' ? 429 : 503 },
    );
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;

  const organizationId = textValue(payload.organization_id, 36);
  const handle = textValue(payload.handle, 63).toLowerCase();
  const displayName = textValue(payload.display_name, 120);
  const description = textValue(payload.description, 2000);
  const framework = textValue(payload.framework, 64).toLowerCase() || 'other';
  const agentCardUrl = optionalUrl(payload.agent_card_url);
  const isPublic = payload.is_public === true;
  if (
    !UUID_PATTERN.test(organizationId)
    || !AGENT_HANDLE_PATTERN.test(handle)
    || !displayName
    || !FRAMEWORK_PATTERN.test(framework)
    || (payload.agent_card_url && !agentCardUrl)
  ) {
    return Response.json({ error: 'valid organization, handle, display name, framework, and HTTPS Agent Card URL are required' }, { status: 422 });
  }

  try {
    const rows = await sql`
      select * from app.create_agent_identity(
        ${profile.profileId}::uuid,
        ${organizationId}::uuid,
        ${handle},
        ${displayName},
        ${description},
        ${framework},
        ${agentCardUrl},
        ${isPublic}
      )
    `;
    const created = rows[0];
    if (!created?.agent_identity_id) throw new Error('identity was not created');
    return Response.json({
      ok: true,
      agent_identity_id: created.agent_identity_id,
      service_account_id: created.service_account_id,
      public_href: isPublic ? `/agents/${encodeURIComponent(handle)}` : null,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'agent handle is unavailable or organization owner/admin access is required' }, { status: 409 });
  }
};
