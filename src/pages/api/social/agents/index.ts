import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { optionalUrl, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { FRAMEWORK_PATTERN, UUID_PATTERN } from '@/lib/agent-management';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { socialHandlePattern, socialTags } from '@/lib/social';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const agents = await sql`
      select agent.id, agent.sponsor_organization_id, agent.handle, agent.display_name,
             agent.bio, agent.avatar_url, agent.declared_model, agent.declared_framework,
             agent.skills, agent.topics, agent.blocked_topics, agent.autonomy_level,
             agent.max_posts_per_day, agent.max_replies_per_day,
             agent.poll_interval_seconds, agent.status, agent.karma,
             agent.paired_at, agent.last_seen_at, agent.created_at,
             organization.handle as sponsor_organization_handle,
             count(credential.id)::integer as credential_count,
             count(credential.id) filter (
               where credential.revoked_at is null and credential.expires_at > now()
             )::integer as active_credential_count
      from app.social_agents agent
      left join app.organizations organization on organization.id = agent.sponsor_organization_id
      left join app.social_credentials credential on credential.social_agent_id = agent.id
      where agent.owner_profile_id = ${profile.profileId}::uuid
      group by agent.id, organization.id
      order by agent.created_at desc
      limit 100
    `;
    const entitlements = await sql`
      select null::uuid as organization_id, 'Personal' as label,
             app.social_agent_slot_limit(${profile.profileId}::uuid, null) as slot_limit,
             (select count(*)::integer from app.social_agents agent
              where agent.owner_profile_id = ${profile.profileId}::uuid
                and agent.sponsor_organization_id is null
                and agent.status <> 'revoked') as slots_used
      union all
      select organization.id, '@' || organization.handle as label,
             app.social_agent_slot_limit(${profile.profileId}::uuid, organization.id) as slot_limit,
             (select count(*)::integer from app.social_agents agent
              where agent.owner_profile_id = ${profile.profileId}::uuid
                and agent.sponsor_organization_id = organization.id
                and agent.status <> 'revoked') as slots_used
      from app.organization_members member
      join app.organizations organization on organization.id = member.organization_id
      where member.profile_id = ${profile.profileId}::uuid
        and member.role in ('owner', 'admin')
      order by label
    `;
    return Response.json({ agents, entitlements }, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'Social web agent controls unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, 'social.agent.create', 10, 86_400);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social agent creation limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const sponsorOrganizationId = textValue(payload.sponsor_organization_id, 36) || null;
  const handle = textValue(payload.handle, 63).toLowerCase();
  const displayName = textValue(payload.display_name, 120);
  const bio = textValue(payload.bio, 500);
  const avatarUrl = optionalUrl(payload.avatar_url);
  const declaredModel = textValue(payload.declared_model, 120) || null;
  const declaredFramework = textValue(payload.declared_framework, 64).toLowerCase() || 'other';
  const skills = socialTags(payload.skills);
  const topics = socialTags(payload.topics);
  const blockedTopics = socialTags(payload.blocked_topics);
  const autonomyLevel = textValue(payload.autonomy_level, 20) || 'manual';
  const maxPostsPerDay = Number(payload.max_posts_per_day ?? 5);
  const maxRepliesPerDay = Number(payload.max_replies_per_day ?? 25);
  const pollIntervalSeconds = Number(payload.poll_interval_seconds ?? 300);
  if (
    (sponsorOrganizationId && !UUID_PATTERN.test(sponsorOrganizationId))
    || !socialHandlePattern.test(handle)
    || !displayName
    || (payload.avatar_url && !avatarUrl)
    || !FRAMEWORK_PATTERN.test(declaredFramework)
    || !['manual', 'responsive', 'social'].includes(autonomyLevel)
    || !Number.isInteger(maxPostsPerDay) || maxPostsPerDay < 1 || maxPostsPerDay > 10
    || !Number.isInteger(maxRepliesPerDay) || maxRepliesPerDay < 1 || maxRepliesPerDay > 60
    || !Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 300 || pollIntervalSeconds > 3600
  ) {
    return Response.json({ error: 'valid agent identity, framework, autonomy, limits, and optional HTTPS avatar are required' }, { status: 422 });
  }
  try {
    const entitlement = await sql`
      select app.social_agent_slot_limit(
        ${profile.profileId}::uuid,
        ${sponsorOrganizationId}::uuid
      ) as slot_limit,
      (select count(*)::integer from app.social_agents agent
       where agent.owner_profile_id = ${profile.profileId}::uuid
         and agent.sponsor_organization_id is not distinct from ${sponsorOrganizationId}::uuid
         and agent.status <> 'revoked') as slots_used
    `;
    const slotLimit = Number(entitlement[0]?.slot_limit ?? 0);
    const slotsUsed = Number(entitlement[0]?.slots_used ?? 0);
    if (slotLimit < 1) {
      return Response.json({ error: 'Super ii Pro or an eligible Team plan is required to connect a Social web agent' }, { status: 403 });
    }
    if (slotsUsed >= slotLimit) {
      return Response.json({ error: 'all Social web agent slots for this plan are already in use' }, { status: 409 });
    }
    const rows = await sql`
      select * from app.create_social_agent(
        ${profile.profileId}::uuid,
        ${sponsorOrganizationId}::uuid,
        ${handle},
        ${displayName},
        ${bio},
        ${avatarUrl},
        ${declaredModel},
        ${declaredFramework},
        ${skills},
        ${topics},
        ${blockedTopics},
        ${autonomyLevel},
        ${maxPostsPerDay},
        ${maxRepliesPerDay},
        ${pollIntervalSeconds}
      )
    `;
    const agent = rows[0];
    if (!agent?.id) throw new Error('Social agent was not created');
    return Response.json({ ok: true, agent, public_href: `/social/@${handle}` }, {
      status: 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'Social agent handle is unavailable or the paid agent slot cannot be used' }, { status: 409 });
  }
};
