#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { optionalShowcaseUrl, showcaseMaximumBytes } from '../src/lib/showcase-input.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const paths = [
  'database/migrations/0032_linked_work_showcase_robot_discovery.sql',
  'database/tests/linked_showcase_smoke.sql',
  'scripts/test-postgres.sh',
  'src/pages/api/bridge/links.ts',
  'src/pages/api/showcase/media/index.ts',
  'src/pages/api/showcase/media/[mediaId].ts',
  'src/pages/showcase-images/[mediaId].jpg.ts',
  'src/pages/api/robot/robots/[robotId]/showcase.ts',
  'src/lib/linked-work.ts',
  'src/lib/i18n.ts',
  'src/pages/bring-my-work.astro',
  'src/components/Catalog.astro',
  'src/components/LinkedWorkGrid.astro',
  'src/components/MemberProfileWorkspace.astro',
  'src/components/RobotWorkspace.astro',
  'src/components/ShowcaseGallery.astro',
  'src/pages/robot/index.astro',
  'src/styles/global.css',
  'src/styles/workspace.css',
  'src/styles/robot.css',
  'wrangler.jsonc',
];
const sources = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await read(path)])));
const combined = Object.values(sources).join('\n');
const requireText = (path, marker) => assert.ok(sources[path].includes(marker), `${path} is missing ${marker}`);

assert.equal(showcaseMaximumBytes, 600_000);
assert.equal(optionalShowcaseUrl('https://example.com/work')?.startsWith('https://example.com/'), true);
for (const unsafe of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com']) {
  assert.throws(() => optionalShowcaseUrl(unsafe));
}

for (const marker of [
  'linked_namespace_not_verified', 'linked_organization_not_verified', 'linked_work_limit_reached',
  'showcase_media_limit_reached', 'resolve_public_showcase_media', 'update_robot_showcase',
  'revoke all on function', 'grant execute on function',
]) assert.ok(combined.includes(marker), `database contract is missing ${marker}`);

for (const path of [
  'src/pages/api/bridge/links.ts',
  'src/pages/api/showcase/media/index.ts',
  'src/pages/api/showcase/media/[mediaId].ts',
  'src/pages/api/robot/robots/[robotId]/showcase.ts',
]) {
  requireText(path, 'sameOrigin(request)');
  requireText(path, 'consumeRateLimit');
}
requireText('src/pages/api/bridge/links.ts', 'inspectHuggingFaceRepository');
requireText('src/pages/api/bridge/links.ts', "visibility !== 'public'");
requireText('src/pages/api/showcase/media/index.ts', 'prepareShowcaseBytes');
requireText('src/pages/api/showcase/media/index.ts', "storageClass: 'Standard'");
requireText('src/pages/showcase-images/[mediaId].jpg.ts', 'resolve_public_showcase_media');
requireText('src/lib/linked-work.ts', 'item.owner_profile_id is not null and profile.id is not null');
requireText('database/migrations/0032_linked_work_showcase_robot_discovery.sql', "p_object_key not like expected_key_prefix || '%'");
requireText('database/migrations/0032_linked_work_showcase_robot_discovery.sql', 'showcase_media_ratio_check');
requireText('wrangler.jsonc', 'SHOWCASE_MEDIA');
requireText('scripts/test-postgres.sh', 'linked_showcase_smoke.sql');

for (const marker of ['Add to profile', 'External · Hugging Face', 'keeps every file on Hugging Face']) {
  assert.ok(combined.includes(marker), `linked-work UI is missing ${marker}`);
}
for (const marker of ['Selected work', 'up to three images', 'profile_kind', 'showcase-editor__grid']) {
  assert.ok(combined.includes(marker), `profile showcase UI is missing ${marker}`);
}
for (const marker of ['Robot builders', 'Robot catalogues', 'Software and open resources', 'robot-showcase-editor']) {
  assert.ok(combined.includes(marker), `Robot discovery UI is missing ${marker}`);
}
assert.ok(/max-width:\s*620px/.test(sources['src/styles/robot.css']), 'Robot discovery lacks narrow viewport treatment');
assert.ok(/max-width:\s*640px/.test(sources['src/styles/workspace.css']), 'showcase editor lacks narrow viewport treatment');
requireText('src/components/RobotWorkspace.astro', "'createImageBitmap' in window");
for (const marker of ['Все публичные проекты', 'Внешние ссылки', 'Публичная витрина ✨']) {
  requireText('src/lib/i18n.ts', marker);
}

console.log('Linked work and showcase check passed: verified provider links, public R2 media, three-image limits, profile portfolios, and Robot discovery are securely wired.');
