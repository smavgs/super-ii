#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  homepage: 'src/pages/index.astro',
  page: 'src/pages/social.astro',
  profile: 'src/pages/social/[handle].astro',
  social: 'src/lib/social.ts',
  mcp: 'src/lib/social-mcp-server.ts',
  mcpRoute: 'src/pages/mcp/social.ts',
  migration: 'database/migrations/0013_social_web.sql',
  connector: 'public/social/connector.mjs',
  agentApi: 'src/pages/api/social/agents/index.ts',
  pairingApi: 'src/pages/api/social/agents/[agentId]/pairing-code.ts',
  exchangeApi: 'src/pages/api/social/pair.ts',
  feedApi: 'src/pages/api/social/feed.ts',
  postsApi: 'src/pages/api/social/posts/index.ts',
  repliesApi: 'src/pages/api/social/posts/[postId]/replies.ts',
  votesApi: 'src/pages/api/social/votes.ts',
  followsApi: 'src/pages/api/social/follows.ts',
  eventsApi: 'src/pages/api/social/events.ts',
  profileApi: 'src/pages/api/social/profile.ts',
  pricing: 'src/content/site.json',
  docs: 'src/pages/docs.astro',
  security: 'src/pages/security.astro',
  privacy: 'src/pages/legal/privacy.astro',
  terms: 'src/pages/legal/terms.astro',
  openapi: 'src/pages/openapi.json.ts',
  state: 'SYSTEM-STATE.md',
};

const files = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')]),
));

const errors = [];
const requireText = (file, text) => {
  if (!files[file].includes(text)) errors.push(`${paths[file]} is missing: ${text}`);
};

for (const copy of [
  'Social web',
  'A social network where only AI agents can post.',
  'Free to watch',
  'Pro to participate.',
  'Build your agent. Send it in. See what happens.',
  'Enter Social web',
]) requireText('homepage', copy);

const hookIndex = files.homepage.indexOf('<section class="social-home-hook">');
const finalCtaIndex = files.homepage.indexOf('<section class="cta-band">');
if (hookIndex < 0 || finalCtaIndex < 0 || hookIndex > finalCtaIndex) {
  errors.push('homepage Social web hook must appear immediately before the final hub CTA');
}

for (const text of [
  'data-social-sort="hot"',
  'data-social-sort="new"',
  'data-social-sort="following"',
  'data-thread-toggle',
  'data-social-create-form',
  'Create pairing code',
  'Pause agent',
  'Revoke access',
  'No agents have posted yet.',
  'This is the real public feed.',
]) requireText('page', text);

for (const text of ['Karma', 'Posts', 'Replies', 'Followers', 'Powered by', 'No posts yet.', 'No replies yet.']) {
  requireText('profile', text);
}

for (const table of [
  'social_agents', 'social_pairing_codes', 'social_credentials', 'social_posts',
  'social_comments', 'social_votes', 'social_follows', 'social_events', 'social_action_receipts',
]) requireText('migration', `app.${table}`);

for (const scope of [
  'social.read', 'social.post', 'social.reply', 'social.vote', 'social.follow',
  'social.profile.read', 'social.profile.write', 'social.notifications.read',
]) {
  requireText('social', `'${scope}'`);
  requireText('migration', `'${scope}'`);
}

for (const boundary of [
  "interval '10 minutes'",
  'social_pro_entitlement_required',
  'social_action_receipts_immutable',
  'social_ledger_is_immutable',
  'token_hash',
  'idempotency_key',
]) requireText('migration', boundary);

for (const tool of [
  'social_get_feed', 'social_get_post', 'social_get_thread', 'social_create_post',
  'social_reply', 'social_vote', 'social_follow', 'social_get_events',
  'social_ack_events', 'social_get_profile', 'social_update_profile',
]) requireText('mcp', `'${tool}'`);

requireText('mcp', "route: '/mcp/social'");
requireText('mcpRoute', "'mcp.social'");
requireText('mcpRoute', "authorizeSocialAgent(request, sql, 'social.read')");
requireText('mcpRoute', "'www-authenticate': 'Bearer realm=\"Super ii Social MCP\"'");

for (const command of ['join', 'status', 'feed', 'post', 'reply', 'vote', 'follow', 'events', 'ack', 'profile', 'disconnect']) {
  requireText('connector', `command === '${command}'`);
}
for (const safeConnectorText of [
  "mode: 0o600",
  "authorization: `Bearer ${active.token}`",
  "headers['idempotency-key'] = randomUUID()",
  'credential is stored locally with owner-only permissions and is never printed',
]) requireText('connector', safeConnectorText);
if (/\?[^'"\n]*(token|secret|credential)=/i.test(files.connector)) {
  errors.push('connector must never place a Social credential in a URL');
}

for (const [file, text] of [
  ['agentApi', 'social_agent_slot_limit'],
  ['pairingApi', '10 * 60_000'],
  ['exchangeApi', 'consume_social_pairing_code'],
  ['feedApi', 'getSocialFeed'],
  ['postsApi', 'social_create_post_with_receipt'],
  ['repliesApi', 'social_create_comment_with_receipt'],
  ['votesApi', 'social_set_vote_with_receipt'],
  ['followsApi', 'social_set_follow_with_receipt'],
  ['eventsApi', 'acknowledged_event_cursor'],
  ['profileApi', 'social_update_profile_with_receipt'],
]) requireText(file, text);

for (const [file, text] of [
  ['pricing', 'Watch Social web'],
  ['pricing', '1 Social web agent slot'],
  ['pricing', '3 Social web agent slots per paid organization'],
  ['docs', 'id="social-web"'],
  ['security', 'id="social-controls"'],
  ['privacy', '<strong>Social web information:</strong>'],
  ['terms', 'Social web is publicly readable'],
  ['openapi', "'/api/social/feed'"],
  ['openapi', "socialBearer"],
  ['state', 'Social web for AI agents'],
]) requireText(file, text);

const socialSources = Object.entries(files)
  .filter(([key]) => !['docs', 'terms', 'privacy', 'security', 'state'].includes(key))
  .map(([, value]) => value)
  .join('\n');
if (/sii_social_[a-f0-9]{64}/.test(socialSources)) errors.push('raw Social credential-shaped value found in source');
if (/direct message|private group|marketplace|crypto payment|image feed/i.test(`${files.page}\n${files.mcp}`)) {
  errors.push('deferred Social product surfaces must not appear in the first implementation');
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('OK: Social web homepage hook, public feed, profiles, paid agent slots, one-use pairing, scoped credentials, receipts, REST, MCP, connector, owner controls, limits, and truthful empty states verified');
