import type { APIRoute } from 'astro';
import { agentScopes, generateAgentToken } from '@/lib/agent-auth';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedAgentIdentity, UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { sha256Hex } from '@/lib/scoped-auth';

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  if (!agent) return Response.json({ error: 'agent identity not found or owner/admin access required' }, { status: 404 });
  const rows = await sql`
    select id, token_prefix, scopes, repository_id, max_actions, actions_used,
           spend_limit_cents, expires_at, last_used_at, revoked_at, created_at
    from app.agent_access_tokens
    where agent_identity_id = ${agent.id}::uuid
    order by created_at desc limit 100
  `;
  return Response.json({ tokens: rows }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  if (!agent || agent.status !== 'active') return Response.json({ error: 'active agent identity and owner/admin access required' }, { status: 404 });
  const rate = await consumeRateLimit(locals, request, sql, 'agent.token.create', 30, 86400);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'agent token creation limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const scopes = Array.from(new Set(
    (Array.isArray(payload.scopes) ? payload.scopes : [])
      .map((value) => textValue(value, 40))
      .filter((value): value is (typeof agentScopes)[number] => agentScopes.includes(value as (typeof agentScopes)[number])),
  ));
  const requestedCount = Array.isArray(payload.scopes) ? new Set(payload.scopes).size : 0;
  const repositoryId = textValue(payload.repository_id, 36) || null;
  const expiresInDays = Number(payload.expires_in_days ?? 7);
  const maxActions = Number(payload.max_actions ?? 500);
  if (
    !scopes.length || scopes.length !== requestedCount
    || (repositoryId && !UUID_PATTERN.test(repositoryId))
    || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30
    || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 10_000
  ) {
    return Response.json({ error: 'valid scopes, optional repository binding, 1-30 day expiry, and 1-10000 action cap are required' }, { status: 422 });
  }
  if (repositoryId) {
    const repositories = await sql`
      select exists (
        select 1 from app.repositories
        where id = ${repositoryId}::uuid
          and owner_organization_id = ${agent.organization_id}::uuid
      ) as allowed
    `;
    if (repositories[0]?.allowed !== true) {
      return Response.json({ error: 'repository binding must belong to the agent operator organization' }, { status: 422 });
    }
  }

  const token = generateAgentToken();
  const tokenHash = await sha256Hex(token);
  const tokenPrefix = `sii_agent_${token.slice('sii_agent_'.length, 'sii_agent_'.length + 8)}`;
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  try {
    const rows = await sql`
      insert into app.agent_access_tokens (
        agent_identity_id, created_by_profile_id, token_prefix, token_hash,
        scopes, repository_id, max_actions, spend_limit_cents, expires_at
      ) values (
        ${agent.id}::uuid, ${profile.profileId}::uuid, ${tokenPrefix}, ${tokenHash},
        ${scopes}, ${repositoryId}::uuid, ${maxActions}, 0, ${expiresAt}::timestamptz
      )
      returning id, token_prefix, scopes, repository_id, max_actions,
                actions_used, spend_limit_cents, expires_at, created_at
    `;
    return Response.json({
      ok: true,
      token,
      warning: 'Copy this token now. Super ii stores only its SHA-256 hash and cannot show it again.',
      token_metadata: rows[0],
    }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'agent token could not be created' }, { status: 409 });
  }
};
