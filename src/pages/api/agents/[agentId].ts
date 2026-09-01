import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { AGENT_HANDLE_PATTERN, FRAMEWORK_PATTERN, managedAgentIdentity } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedAgentIdentity(sql, profile.profileId, params.agentId ?? '');
  if (!agent) return Response.json({ error: 'agent identity not found or owner/admin access required' }, { status: 404 });
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;

  const handle = payload.handle === undefined ? agent.handle : textValue(payload.handle, 63).toLowerCase();
  const displayName = payload.display_name === undefined ? agent.display_name : textValue(payload.display_name, 120);
  const description = payload.description === undefined ? agent.description : textValue(payload.description, 2000);
  const framework = payload.framework === undefined ? agent.framework : textValue(payload.framework, 64).toLowerCase();
  const agentCardUrl = payload.agent_card_url === undefined
    ? agent.agent_card_url
    : optionalUrl(payload.agent_card_url);
  const isPublic = payload.is_public === undefined ? agent.is_public : payload.is_public === true;
  const status = payload.status === undefined ? agent.status : textValue(payload.status, 20);
  if (
    !AGENT_HANDLE_PATTERN.test(handle)
    || !displayName
    || !FRAMEWORK_PATTERN.test(framework)
    || (payload.agent_card_url && !agentCardUrl)
    || !['active', 'disabled'].includes(status)
  ) {
    return Response.json({ error: 'invalid agent identity update' }, { status: 422 });
  }
  try {
    const rows = await sql`
      update app.agent_identities
      set handle = ${handle}, display_name = ${displayName}, description = ${description},
          framework = ${framework}, agent_card_url = ${agentCardUrl},
          is_public = ${isPublic}, status = ${status}
      where id = ${agent.id}::uuid
      returning id, handle, display_name, description, framework,
                agent_card_url, is_public, status, updated_at
    `;
    if (status === 'disabled') {
      await sql`
        update app.agent_access_tokens set revoked_at = coalesce(revoked_at, now())
        where agent_identity_id = ${agent.id}::uuid and revoked_at is null
      `;
    }
    return Response.json({ ok: true, agent: rows[0] });
  } catch {
    return Response.json({ error: 'agent identity could not be updated' }, { status: 409 });
  }
};
