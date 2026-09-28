import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPublicCardSnapshot, cardVcard, defaultCardConfig, emptyCardVault,
  maximumCardsPerProfile, parseCardConfig, parseCardVault, publicCardPhotoSource, serviceHref,
} from '../src/lib/cards.ts';
import { jpegDimensions, stripJpegMetadata } from '../src/lib/card-photo.ts';

const vault = emptyCardVault('Ada Lovelace');
vault.identity_en.role = 'Builder';
vault.identity_en.organization = 'Super ii';
vault.identity_en.tagline = 'Open intelligence, built together.';
vault.identity_zh = { name: '阿达', role: '开发者', organization: 'Super ii', tagline: '一起构建开放智能。', bio: '' };
vault.email = 'ada@example.com';
vault.services.wechat = 'ada_wechat';
vault.services.github = 'ada';
vault.custom_links = [{ label: 'Research', url: 'https://example.com/research' }];

assert.equal(parseCardVault(vault).ok, true);
assert.equal(parseCardVault({ ...vault, website: 'javascript:alert(1)' }).ok, false);
assert.equal(parseCardVault({ ...vault, email: 'not-an-email' }).ok, false);
assert.equal(parseCardVault({ ...vault, photo_url: 'https://tracker.example/pixel.gif' }).ok, false);
assert.equal(parseCardVault({ ...vault, photo_url: 'https://img.clerk.com/example.png' }).ok, true);
assert.equal(parseCardVault({ ...vault, photo_url: 'https://superii.site/card-images/00000000-0000-4000-8000-000000000001.jpg' }).ok, true);
assert.equal(parseCardVault({ ...vault, services: { unknown: 'no' } }).ok, false);
assert.equal(parseCardVault({ ...vault, services: { email: 'other@example.com' } }).ok, false);
assert.equal(serviceHref('wechat', 'ada_wechat'), null);
assert.equal(serviceHref('github', '@ada'), 'https://github.com/ada');
assert.equal(serviceHref('github', 'https://github.com.example/ada'), null);
assert.equal(serviceHref('linkedin', 'https://www.linkedin.com/in/ada'), 'https://www.linkedin.com/in/ada');
assert.equal(serviceHref('linkedin', 'https://linkedin.example/in/ada'), null);
assert.equal(serviceHref('whatsapp', '+1 (415) 555-0123'), 'https://wa.me/14155550123');
assert.equal(serviceHref('website', 'http://example.com'), null);
assert.equal(maximumCardsPerProfile, 6);
assert.equal(
  publicCardPhotoSource('https://superii.site/card-images/00000000-0000-4000-8000-000000000001.jpg'),
  '/card-images/00000000-0000-4000-8000-000000000001.jpg',
);
assert.equal(
  publicCardPhotoSource('https://www.superii.site/card-images/00000000-0000-4000-8000-000000000001.jpg'),
  '/card-images/00000000-0000-4000-8000-000000000001.jpg',
);
assert.equal(publicCardPhotoSource('https://img.clerk.com/example.png'), 'https://img.clerk.com/example.png');

const config = defaultCardConfig('open_source');
config.verified_badges = ['publisher', 'founding_200'];
config.services = ['email', 'wechat', 'github'];
config.custom_links = [0];
const parsedConfig = parseCardConfig(config);
assert.equal(parsedConfig.ok, true);
assert.equal(parseCardConfig({ ...config, personal_badges: ['invented'] }).ok, false);

const snapshot = buildPublicCardSnapshot({
  cardId: '00000000-0000-4000-8000-000000000001', cardName: 'Open source', preset: 'open_source',
  config, vault, eligibleBadges: ['publisher'], publishedAt: '2026-09-27T00:00:00.000Z',
});
assert.deepEqual(snapshot.verified_badges, ['publisher']);
assert.equal(snapshot.services.find((service) => service.id === 'wechat')?.href, null);
assert.equal(snapshot.services.find((service) => service.id === 'custom')?.href, 'https://example.com/research');
const noChineseName = buildPublicCardSnapshot({
  cardId: '00000000-0000-4000-8000-000000000001', cardName: 'English fallback', preset: 'superii',
  config: { ...config, default_locale: 'zh-CN' },
  vault: { ...vault, identity_zh: { name: '', role: '开发者', organization: '', tagline: '', bio: '' } },
  eligibleBadges: [], publishedAt: '2026-09-27T00:00:00.000Z',
});
assert.equal(noChineseName.identity_zh, null);
assert.equal(noChineseName.default_locale, 'en');
assert.match(cardVcard(snapshot), /FN:Ada Lovelace\r\n/);
assert.match(cardVcard(snapshot, 'zh-CN'), /FN:阿达\r\n/);
assert.match(cardVcard(snapshot), /VERSION:4\.0\r\n/);
for (const line of cardVcard({ ...snapshot, identity_en: { ...snapshot.identity_en, bio: 'AI '.repeat(100) } }).split('\r\n')) {
  assert.ok(new TextEncoder().encode(line).byteLength <= 75, 'vCard physical lines must be folded to 75 octets');
}

const jpegFixture = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x64, 0x00, 0x64, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x00, 0xff, 0xd9,
]);
assert.deepEqual(jpegDimensions(jpegFixture), { width: 100, height: 100 });
const strippedJpeg = stripJpegMetadata(jpegFixture);
assert.ok(strippedJpeg.byteLength < jpegFixture.byteLength);
assert.ok(!new TextDecoder().decode(strippedJpeg).includes('Exif'));

const migration = readFileSync(new URL('../database/migrations/0029_super_ii_cards.sql', import.meta.url), 'utf8');
for (const required of [
  'enable row level security', 'resolve_public_card', 'submit_card_connection',
  'security definer', 'revoke all on function', 'install_least_privilege_policies',
  'card_public_snapshots_owner_matches_card', 'card_connections_owner_matches_card',
]) assert.ok(migration.toLowerCase().includes(required), `missing card database boundary: ${required}`);
assert.ok(!migration.includes('grant select on app.cards to public'));
const photoMigration = readFileSync(new URL('../database/migrations/0030_card_photos.sql', import.meta.url), 'utf8');
for (const required of [
  'enable row level security', 'resolve_public_card_photo', 'security definer',
  'card_photos_owner_all', "mime_type = 'image/jpeg'",
]) assert.ok(photoMigration.toLowerCase().includes(required), `missing card photo boundary: ${required}`);
assert.ok(!photoMigration.includes('grant select on app.card_photos to public'));
const limitMigration = readFileSync(new URL('../database/migrations/0031_card_limit.sql', import.meta.url), 'utf8');
for (const required of [
  'pg_advisory_xact_lock', '>= 6', 'card_limit_reached', 'cards_owner_limit_before_insert',
]) assert.ok(limitMigration.toLowerCase().includes(required), `missing six-Card database boundary: ${required}`);

const cardWorkspace = readFileSync(new URL('../src/components/CardWorkspace.astro', import.meta.url), 'utf8');
assert.match(cardWorkspace, /data-card-photo-file/);
assert.match(cardWorkspace, /capture="user"/);
assert.doesNotMatch(cardWorkspace, /Profile photo URL/);
assert.match(cardWorkspace, /data-card-count>0<\/span> of 6/);
assert.match(cardWorkspace, /data-card-save-status/);
assert.doesNotMatch(cardWorkspace, /data-copy-card-link/);
const cardScript = readFileSync(new URL('../src/scripts/cards.ts', import.meta.url), 'utf8');
assert.match(cardScript, /createImageBitmap/);
assert.match(cardScript, /canvas\.toBlob/);
assert.match(cardScript, /\/api\/cards\/photo/);
assert.match(cardScript, /state\.cards = \[result\.card/);
assert.match(cardScript, /Published successfully ✓/);
assert.match(cardScript, /state\.cards\.length >= maximumCards/);

const middleware = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
assert.match(middleware, /\^\\\/c\\\/\[\^\/\]\+/);
const publicCard = readFileSync(new URL('../src/pages/c/[token].astro', import.meta.url), 'utf8');
assert.doesNotMatch(publicCard, /Unlisted link · Not indexed/);
assert.doesNotMatch(publicCard, /<p class="eyebrow">\{snapshot\.name\}<\/p>/);
assert.match(publicCard, /data-card-vcard/);
assert.match(publicCard, /publicCardPhotoSource/);
assert.match(publicCard, /href="weixin:\/\/"/);
assert.match(publicCard, /public-card__share-button/);
assert.match(publicCard, /public-card__make-button/);
const publicCardScript = readFileSync(new URL('../src/scripts/card-public.ts', import.meta.url), 'utf8');
assert.match(publicCardScript, /searchParams\.set\('language', 'zh-CN'\)/);
assert.match(publicCardScript, /data-card-copy/);
assert.match(publicCardScript, /data-open-wechat/);
assert.match(publicCardScript, /document\.documentElement\.lang = locale/);
assert.match(publicCardScript, /data-card-skip-link/);
const cardLayout = readFileSync(new URL('../src/layouts/CardLayout.astro', import.meta.url), 'utf8');
assert.match(cardLayout, /data-card-skip-link/);
const publicJson = readFileSync(new URL('../src/pages/c/[token]/card.json.ts', import.meta.url), 'utf8');
assert.match(publicJson, /https:\/\/superii\.site\/schemas\/card\/v1\.json/);
const openapi = readFileSync(new URL('../src/pages/openapi.json.ts', import.meta.url), 'utf8');
assert.match(openapi, /cardApiPaths/);
const architecture = readFileSync(new URL('../docs/architecture/cards.md', import.meta.url), 'utf8');
assert.match(architecture, /AES-256-GCM/);
assert.match(architecture, /unlisted bearer-like access/);
console.log('Card checks passed: strict input parsing, safe same-origin photos, six-Card enforcement, complete bilingual UI, safe service actions, verified-badge filtering, vCard output, owner-bound encrypted storage, and bearer-link privacy.');
