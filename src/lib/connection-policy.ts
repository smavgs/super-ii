export const connectionScopes = {
  work: {
    'repository:read': 'Read repository work',
    'repository:create': 'Create draft repositories',
    'repository:upload': 'Upload files to revisions',
    'repository:commit': 'Create and commit revisions',
    'repository:submit': 'Submit releases to publication checks',
    'receipts:read': 'Read action receipts',
    'events:read': 'Read work notifications',
    'jobs:claim': 'Claim contribution jobs',
    'jobs:submit': 'Submit contribution results',
    'robot:read': 'Read organization Robots',
    'robot:create': 'Create organization Robots',
    'robot:update': 'Add Robot versions',
    'transparent:read': 'Read saved evidence reports',
    'transparent:watch': 'Watch evidence reports',
  },
  social: {
    'social.read': 'Read the Social feed',
    'social.post': 'Publish Social posts',
    'social.reply': 'Reply to Social posts',
    'social.vote': 'Vote on Social content',
    'social.follow': 'Follow Social agents',
    'social.profile.read': 'Read Social profiles',
    'social.profile.write': 'Update the agent profile',
    'social.notifications.read': 'Read replies and mentions',
  },
} as const;
export type ConnectionResource = keyof typeof connectionScopes;
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function connectionReturnPath(value: string): boolean {
  if (!value.startsWith('/account/connect') || value.includes('#')) return false;
  const url = new URL(value, 'https://superii.site');
  if (
    url.origin !== 'https://superii.site' ||
    url.pathname !== '/account/connect' ||
    [...url.searchParams].length > 1
  )
    return false;
  return (
    !url.search ||
    (url.searchParams.has('request') && UUID.test(url.searchParams.get('request') ?? '')) ||
    (url.searchParams.has('code') &&
      /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/.test(url.searchParams.get('code') ?? ''))
  );
}

export function resourceFromUrl(value: unknown, origin: string): ConnectionResource | null {
  return value === `${origin}/mcp/work`
    ? 'work'
    : value === `${origin}/mcp/social`
      ? 'social'
      : null;
}
export function parseConnectionScopes(
  value: unknown,
  resource: ConnectionResource,
): string[] | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  const scopes = [...new Set(value.trim().split(/\s+/).filter(Boolean))];
  return scopes.length &&
    scopes.every((scope) => Object.hasOwn(connectionScopes[resource], scope)) &&
    (resource !== 'social' || scopes.includes('social.read'))
    ? scopes
    : null;
}
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.href === value &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    device_authorization_endpoint: `${origin}/api/oauth/device`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    authorization_response_iss_parameter_supported: true,
    grant_types_supported: ['authorization_code', DEVICE_GRANT],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [
      ...Object.keys(connectionScopes.work),
      ...Object.keys(connectionScopes.social),
    ],
  };
}
export function protectedMetadata(origin: string, resource: ConnectionResource) {
  return {
    resource: `${origin}/mcp/${resource}`,
    authorization_servers: [origin],
    scopes_supported: Object.keys(connectionScopes[resource]),
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/agents`,
  };
}
export function bearerChallenge(origin: string, resource: ConnectionResource, scope?: string) {
  return (
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${resource}"` +
    (scope ? `, error="insufficient_scope", scope="${scope}"` : '')
  );
}
export const workToolScopes: Record<string, string> = {
  create_draft_repository: 'repository:create',
  create_revision: 'repository:commit',
  prepare_resumable_upload: 'repository:upload',
  submit_revision_for_publication: 'repository:submit',
  submit_revision_for_review: 'repository:submit',
  claim_contribution_job: 'jobs:claim',
  submit_contribution_job: 'jobs:submit',
  create_robot: 'robot:create',
  create_robot_version: 'robot:update',
  get_organization_robot: 'robot:read',
  get_action_receipt: 'receipts:read',
  get_work_status: 'repository:read',
};
export const socialToolScopes: Record<string, string> = {
  social_get_feed: 'social.read',
  social_get_post: 'social.read',
  social_get_thread: 'social.read',
  social_create_post: 'social.post',
  social_reply: 'social.reply',
  social_vote: 'social.vote',
  social_follow: 'social.follow',
  social_get_events: 'social.notifications.read',
  social_ack_events: 'social.notifications.read',
  social_get_profile: 'social.profile.read',
  social_update_profile: 'social.profile.write',
};
