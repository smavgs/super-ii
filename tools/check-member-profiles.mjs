#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEditableMemberProfile } from '../src/lib/member-profile.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const validInput = {
  bio: 'Building open, local AI tools.',
  interests: ['Local AI', 'Agents', 'local ai'],
  x_username: '@superiisite',
  github_username: 'super-ii',
  linkedin_url: 'https://www.linkedin.com/in/super-ii',
  website_url: 'https://superii.site',
  youtube_url: 'https://www.youtube.com/@superii',
};
const valid = parseEditableMemberProfile(validInput);
assert.equal(valid.ok, true);
if (valid.ok) {
  assert.equal(valid.value.x_username, 'superiisite');
  assert.deepEqual(valid.value.interests, ['Local AI', 'Agents']);
  assert.equal(valid.value.website_url, 'https://superii.site/');
}

for (const input of [
  { ...validInput, unexpected: true },
  { ...validInput, interests: Array.from({ length: 13 }, (_, index) => `Interest ${index}`) },
  { ...validInput, bio: 'x'.repeat(501) },
  { ...validInput, x_username: 'not a handle!' },
  { ...validInput, github_username: '-invalid' },
  { ...validInput, linkedin_url: 'https://example.com/profile' },
  { ...validInput, youtube_url: 'http://youtube.com/@unsafe' },
  { ...validInput, website_url: 'javascript:alert(1)' },
  { ...validInput, website_url: 'https://user:password@example.com' },
]) {
  assert.equal(parseEditableMemberProfile(input).ok, false, `expected invalid profile: ${JSON.stringify(input)}`);
}

const [migration, smoke, schema, profileApi, likeApi, followApi, workspace, publicPage, css, runner] = await Promise.all([
  read('database/migrations/0018_profile_likes_links.sql'),
  read('database/tests/profile_likes_smoke.sql'),
  read('src/lib/schema.ts'),
  read('src/pages/api/profile.ts'),
  read('src/pages/api/profiles/[profileId]/like.ts'),
  read('src/pages/api/profiles/[profileId]/follow.ts'),
  read('src/components/MemberProfileWorkspace.astro'),
  read('src/pages/people/[handle].astro'),
  read('src/styles/global.css'),
  read('scripts/test-postgres.sh'),
]);

const requireText = (source, marker, path) => assert.ok(source.includes(marker), `${path} is missing ${marker}`);
for (const marker of ['app.profile_likes', 'app.set_profile_like', 'cannot_like_self', 'profile_likes_public_read', 'youtube_url']) {
  requireText(migration, marker, 'profile migration');
}
for (const marker of ['Profile like replay was not idempotent', 'Profile like changed the repository-like relation', 'Self-like was accepted', 'A private profile accepted']) {
  requireText(smoke, marker, 'profile smoke test');
}
requireText(schema, "'profile_likes'", 'schema');
for (const source of [profileApi, likeApi, followApi]) {
  requireText(source, 'sameOrigin(request)', 'profile API');
  requireText(source, 'readBoundedJsonObject', 'profile API');
  requireText(source, 'consumeRateLimit', 'profile API');
}
for (const marker of ['YouTube', 'These are public links you provide; they are not verified connections.', "fetch('/api/profile'"]) {
  requireText(workspace, marker, 'profile workspace');
}
for (const marker of ['data-profile-like', 'data-profile-follow', 'ph-youtube-logo', 'person-interests', 'rel="me nofollow noopener noreferrer"']) {
  requireText(publicPage, marker, 'public profile');
}
for (const marker of ['.member-profile-form', '.person-stats', '.person-like-button--active', '@media (max-width: 700px)']) {
  requireText(css, marker, 'profile styles');
}
requireText(runner, 'profile_likes_smoke.sql', 'Postgres test runner');

assert.ok(!migration.includes('app.likes ('), 'profile migration must not redefine repository likes');
assert.ok(!publicPage.includes('order by likes_count'), 'profile likes must not influence repository or profile ranking');

console.log('Member profile check passed: bounded profile editing, five public link types including YouTube, separate reversible likes, and responsive UI are wired.');
