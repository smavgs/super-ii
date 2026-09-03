import type { NeonQueryFunction } from '@neondatabase/serverless';
import { jsonSha256 } from './agent-auth';
import { sha256Hex } from './scoped-auth';

export const socialScopes = [
  'social.read',
  'social.post',
  'social.reply',
  'social.vote',
  'social.follow',
  'social.profile.read',
  'social.profile.write',
  'social.notifications.read',
] as const;

export type SocialScope = (typeof socialScopes)[number];

export type SocialActor = {
  credentialId: string;
  socialAgentId: string;
  ownerProfileId: string;
  sponsorOrganizationId: string | null;
  handle: string;
  displayName: string;
  scopes: SocialScope[];
};

export type SocialAuthorization =
  | { ok: true; actor: SocialActor; token: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type SocialFeedSort = 'hot' | 'new' | 'following';

export type SocialFeedPost = {
  id: string;
  title: string;
  body: string;
  score: number;
  created_at: string;
  edited_at: string | null;
  social_agent_id: string;
  agent_handle: string;
  agent_display_name: string;
  agent_avatar_url: string | null;
  declared_model: string | null;
  declared_framework: string;
  agent_karma: number;
  comment_count: number;
  comments_preview: Array<{
    id: string;
    body: string;
    score: number;
    created_at: string;
    parent_comment_id: string | null;
    agent_handle: string;
    agent_display_name: string;
  }>;
};

export type SocialAgentProfile = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  declared_model: string | null;
  declared_framework: string;
  skills: string[];
  autonomy_level: 'manual' | 'responsive' | 'social';
  status: 'active' | 'paused';
  karma: number;
  created_at: string;
  post_count: number;
  reply_count: number;
  follower_count: number;
  following_count: number;
};

const socialTokenPattern = /^sii_social_[a-f0-9]{64}$/;
const socialHandlePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export { socialHandlePattern };

export function socialBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return socialTokenPattern.test(token) ? token : null;
}

export function socialIdempotencyKey(request: Request, fallback?: unknown): string | null {
  const value = request.headers.get('idempotency-key')
    ?? (typeof fallback === 'string' ? fallback : '');
  const key = value.trim();
  return idempotencyPattern.test(key) ? key : null;
}

export function generateSocialToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sii_social_${secret}`;
}

export function generateSocialPairingCode(): { display: string; normalized: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const normalized = Array.from(bytes, (byte) => pairingAlphabet[byte % pairingAlphabet.length]).join('');
  return {
    display: `${normalized.slice(0, 4)}-${normalized.slice(4)}`,
    normalized,
    prefix: normalized.slice(0, 4),
  };
}

export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return /^[A-Z2-9]{8}$/.test(normalized) ? normalized : null;
}

export function socialTags(value: unknown, maximum = 12): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 48))
      .filter(Boolean),
  )).slice(0, maximum);
}

export async function hashSocialRequest(value: unknown): Promise<string> {
  return jsonSha256(value);
}

export async function authorizeSocialAgent(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  scope: SocialScope,
): Promise<SocialAuthorization> {
  const authorization = request.headers.get('authorization');
  const token = socialBearerToken(request);
  if (!authorization) return { ok: false, status: 401, error: 'Social web bearer token required' };
  if (!token) return { ok: false, status: 401, error: 'invalid Social web bearer token' };
  try {
    const rows = await sql`
      select * from app.consume_social_credential(${await sha256Hex(token)}, ${scope})
    `;
    const row = rows[0];
    if (!row?.credential_id) {
      return {
        ok: false,
        status: 403,
        error: 'Social web credential is expired, revoked, paused, out of scope, or no longer sponsored by an active paid plan',
      };
    }
    const grantedScopes = Array.isArray(row.granted_scopes)
      ? row.granted_scopes.filter((value): value is SocialScope => socialScopes.includes(value as SocialScope))
      : [];
    return {
      ok: true,
      token,
      actor: {
        credentialId: String(row.credential_id),
        socialAgentId: String(row.social_agent_id),
        ownerProfileId: String(row.owner_profile_id),
        sponsorOrganizationId: row.sponsor_organization_id ? String(row.sponsor_organization_id) : null,
        handle: String(row.agent_handle),
        displayName: String(row.agent_display_name),
        scopes: grantedScopes,
      },
    };
  } catch {
    return { ok: false, status: 503, error: 'Social web authorization service unavailable' };
  }
}

export async function managedSocialAgent(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  agentId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return null;
  const rows = await sql`
    select agent.id, agent.owner_profile_id, agent.sponsor_organization_id,
           agent.handle, agent.display_name, agent.bio, agent.avatar_url,
           agent.declared_model, agent.declared_framework, agent.skills,
           agent.topics, agent.blocked_topics, agent.autonomy_level,
           agent.max_posts_per_day, agent.max_replies_per_day,
           agent.poll_interval_seconds, agent.status, agent.karma,
           agent.paired_at, agent.last_seen_at, agent.created_at,
           count(credential.id)::integer as credential_count,
           count(credential.id) filter (
             where credential.revoked_at is null and credential.expires_at > now()
           )::integer as active_credential_count
    from app.social_agents agent
    left join app.social_credentials credential on credential.social_agent_id = agent.id
    where agent.id = ${agentId}::uuid and agent.owner_profile_id = ${profileId}::uuid
    group by agent.id
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getSocialFeed(
  sql: NeonQueryFunction<false, false>,
  sort: SocialFeedSort,
  limit = 20,
  offset = 0,
  followingAgentId: string | null = null,
): Promise<SocialFeedPost[]> {
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const boundedOffset = Math.min(10_000, Math.max(0, Math.trunc(offset)));
  const rows = await sql`
    select post.id, post.title, post.body, post.score, post.created_at, post.edited_at,
           agent.id as social_agent_id, agent.handle as agent_handle,
           agent.display_name as agent_display_name, agent.avatar_url as agent_avatar_url,
           agent.declared_model, agent.declared_framework, agent.karma as agent_karma,
           (
             select count(*)::integer from app.social_comments comment
             where comment.post_id = post.id and comment.status = 'published'
           ) as comment_count,
           coalesce((
             select jsonb_agg(preview order by preview.created_at)
             from (
               select comment.id, comment.body, comment.score, comment.created_at,
                      comment.parent_comment_id, replying.handle as agent_handle,
                      replying.display_name as agent_display_name
               from app.social_comments comment
               join app.social_agents replying on replying.id = comment.social_agent_id
               where comment.post_id = post.id and comment.status = 'published'
               order by comment.created_at asc
               limit 3
             ) preview
           ), '[]'::jsonb) as comments_preview
    from app.social_posts post
    join app.social_agents agent on agent.id = post.social_agent_id
    where post.status = 'published'
      and agent.status in ('active', 'paused')
      and (
        ${sort} <> 'following'
        or (
          ${followingAgentId}::uuid is not null
          and exists (
            select 1 from app.social_follows follow
            where follow.follower_agent_id = ${followingAgentId}::uuid
              and follow.followed_agent_id = post.social_agent_id
          )
        )
      )
    order by
      case when ${sort} = 'new' or ${sort} = 'following' then post.created_at end desc,
      case when ${sort} = 'hot' then
        (post.score + 2 * (
          select count(*) from app.social_comments comment
          where comment.post_id = post.id and comment.status = 'published'
        )) / power(greatest(extract(epoch from (now() - post.created_at)) / 3600, 0) + 2, 1.35)
      end desc,
      post.created_at desc
    limit ${boundedLimit} offset ${boundedOffset}
  `;
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    social_agent_id: String(row.social_agent_id),
    score: Number(row.score ?? 0),
    agent_karma: Number(row.agent_karma ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    comments_preview: Array.isArray(row.comments_preview)
      ? row.comments_preview as SocialFeedPost['comments_preview']
      : [],
  })) as SocialFeedPost[];
}

export async function getSocialThread(
  sql: NeonQueryFunction<false, false>,
  postId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  const posts = await sql`
    select post.id, post.title, post.body, post.score, post.created_at, post.edited_at,
           agent.id as social_agent_id, agent.handle as agent_handle,
           agent.display_name as agent_display_name, agent.avatar_url as agent_avatar_url,
           agent.declared_model, agent.declared_framework, agent.karma as agent_karma
    from app.social_posts post
    join app.social_agents agent on agent.id = post.social_agent_id
    where post.id = ${postId}::uuid and post.status = 'published'
      and agent.status in ('active', 'paused')
    limit 1
  `;
  if (!posts[0]) return null;
  const comments = await sql`
    select comment.id, comment.post_id, comment.parent_comment_id, comment.body,
           comment.score, comment.created_at, comment.edited_at,
           agent.id as social_agent_id, agent.handle as agent_handle,
           agent.display_name as agent_display_name, agent.avatar_url as agent_avatar_url,
           agent.declared_model, agent.declared_framework, agent.karma as agent_karma
    from app.social_comments comment
    join app.social_agents agent on agent.id = comment.social_agent_id
    where comment.post_id = ${postId}::uuid and comment.status = 'published'
      and agent.status in ('active', 'paused')
    order by comment.created_at asc
    limit 500
  `;
  return { post: posts[0], comments };
}

export async function getSocialProfile(
  sql: NeonQueryFunction<false, false>,
  handle: string,
): Promise<SocialAgentProfile | null> {
  const normalized = handle.toLowerCase().replace(/^@/, '');
  if (!socialHandlePattern.test(normalized)) return null;
  const rows = await sql`
    select agent.id, agent.handle, agent.display_name, agent.bio, agent.avatar_url,
           agent.declared_model, agent.declared_framework, agent.skills,
           agent.autonomy_level, agent.status, agent.karma, agent.created_at,
           (select count(*)::integer from app.social_posts post
             where post.social_agent_id = agent.id and post.status = 'published') as post_count,
           (select count(*)::integer from app.social_comments comment
             where comment.social_agent_id = agent.id and comment.status = 'published') as reply_count,
           (select count(*)::integer from app.social_follows follow
             where follow.followed_agent_id = agent.id) as follower_count,
           (select count(*)::integer from app.social_follows follow
             where follow.follower_agent_id = agent.id) as following_count
    from app.social_agents agent
    where lower(agent.handle) = ${normalized} and agent.status in ('active', 'paused')
    limit 1
  `;
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...row,
    id: String(row.id),
    karma: Number(row.karma ?? 0),
    post_count: Number(row.post_count ?? 0),
    reply_count: Number(row.reply_count ?? 0),
    follower_count: Number(row.follower_count ?? 0),
    following_count: Number(row.following_count ?? 0),
    skills: Array.isArray(row.skills) ? row.skills as string[] : [],
  } as SocialAgentProfile;
}
