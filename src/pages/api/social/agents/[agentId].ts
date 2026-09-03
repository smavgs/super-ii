import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { FRAMEWORK_PATTERN } from '@/lib/agent-management';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { managedSocialAgent, socialHandlePattern, socialTags } from '@/lib/social';

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const agent = await managedSocialAgent(sql, profile.profileId, params.agentId ?? '');
  if (!agent) return Response.json({ error: 'Social agent not found' }, { status: 404 });
  const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, 'social.agent.manage', 60, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social agent management limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const action = textValue(payload.action, 20) || 'update';

  try {
    if (action === 'pause') {
      const rows = await sql`
        update app.social_agents set status = 'paused'
        where id = ${String(agent.id)}::uuid and status = 'active'
        returning id, handle, status
      `;
      if (!rows.length) return Response.json({ error: 'only an active Social agent can be paused' }, { status: 409 });
      return Response.json({ ok: true, agent: rows[0] });
    }
    if (action === 'resume') {
      const rows = await sql`
        update app.social_agents target set status = 'active'
        where target.id = ${String(agent.id)}::uuid
          and target.status = 'paused'
          and app.social_agent_slot_limit(target.owner_profile_id, target.sponsor_organization_id) > 0
          and exists (
            select 1 from app.social_credentials credential
            where credential.social_agent_id = target.id
              and credential.revoked_at is null and credential.expires_at > now()
          )
        returning target.id, target.handle, target.status
      `;
      if (!rows.length) return Response.json({ error: 'an active paid plan and credential are required to resume' }, { status: 409 });
      return Response.json({ ok: true, agent: rows[0] });
    }
    if (action === 'revoke') {
      await sql`
        update app.social_pairing_codes set revoked_at = coalesce(revoked_at, now())
        where social_agent_id = ${String(agent.id)}::uuid and consumed_at is null
      `;
      await sql`
        update app.social_credentials set revoked_at = coalesce(revoked_at, now())
        where social_agent_id = ${String(agent.id)}::uuid and revoked_at is null
      `;
      const rows = await sql`
        update app.social_agents set status = 'revoked'
        where id = ${String(agent.id)}::uuid
        returning id, handle, status
      `;
      return Response.json({ ok: true, agent: rows[0] });
    }
    if (action !== 'update') return Response.json({ error: 'invalid Social agent action' }, { status: 422 });

    const handle = payload.handle === undefined ? String(agent.handle) : textValue(payload.handle, 63).toLowerCase();
    const displayName = payload.display_name === undefined ? String(agent.display_name) : textValue(payload.display_name, 120);
    const bio = payload.bio === undefined ? String(agent.bio) : textValue(payload.bio, 500);
    const avatarUrl = payload.avatar_url === undefined ? agent.avatar_url as string | null : optionalUrl(payload.avatar_url);
    const declaredModel = payload.declared_model === undefined
      ? agent.declared_model as string | null
      : textValue(payload.declared_model, 120) || null;
    const declaredFramework = payload.declared_framework === undefined
      ? String(agent.declared_framework)
      : textValue(payload.declared_framework, 64).toLowerCase();
    const skills = payload.skills === undefined ? agent.skills as string[] : socialTags(payload.skills);
    const topics = payload.topics === undefined ? agent.topics as string[] : socialTags(payload.topics);
    const blockedTopics = payload.blocked_topics === undefined ? agent.blocked_topics as string[] : socialTags(payload.blocked_topics);
    const autonomyLevel = payload.autonomy_level === undefined ? String(agent.autonomy_level) : textValue(payload.autonomy_level, 20);
    const maxPosts = payload.max_posts_per_day === undefined ? Number(agent.max_posts_per_day) : Number(payload.max_posts_per_day);
    const maxReplies = payload.max_replies_per_day === undefined ? Number(agent.max_replies_per_day) : Number(payload.max_replies_per_day);
    const pollSeconds = payload.poll_interval_seconds === undefined ? Number(agent.poll_interval_seconds) : Number(payload.poll_interval_seconds);
    if (
      !socialHandlePattern.test(handle) || !displayName
      || (payload.avatar_url && !avatarUrl)
      || !FRAMEWORK_PATTERN.test(declaredFramework)
      || !['manual', 'responsive', 'social'].includes(autonomyLevel)
      || !Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 10
      || !Number.isInteger(maxReplies) || maxReplies < 1 || maxReplies > 60
      || !Number.isInteger(pollSeconds) || pollSeconds < 300 || pollSeconds > 3600
    ) {
      return Response.json({ error: 'invalid Social agent profile or limits' }, { status: 422 });
    }
    const rows = await sql`
      update app.social_agents
      set handle = ${handle}, display_name = ${displayName}, bio = ${bio},
          avatar_url = ${avatarUrl}, declared_model = ${declaredModel},
          declared_framework = ${declaredFramework}, skills = ${skills},
          topics = ${topics}, blocked_topics = ${blockedTopics},
          autonomy_level = ${autonomyLevel}, max_posts_per_day = ${maxPosts},
          max_replies_per_day = ${maxReplies}, poll_interval_seconds = ${pollSeconds}
      where id = ${String(agent.id)}::uuid and status <> 'revoked'
      returning id, handle, display_name, bio, avatar_url, declared_model,
                declared_framework, skills, topics, blocked_topics,
                autonomy_level, max_posts_per_day, max_replies_per_day,
                poll_interval_seconds, status, updated_at
    `;
    if (!rows.length) return Response.json({ error: 'revoked Social agents cannot be changed' }, { status: 409 });
    return Response.json({ ok: true, agent: rows[0] });
  } catch {
    return Response.json({ error: 'Social agent could not be changed' }, { status: 409 });
  }
};
