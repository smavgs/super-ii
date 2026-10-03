import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(`Social metadata check failed: ${message}`);
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) fail(`missing ${relativePath}`);
  return fs.readFileSync(fullPath);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function pngDimensions(relativePath) {
  const buffer = read(relativePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buffer.subarray(0, 8).equals(signature), `${relativePath} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

const expectedPngs = new Map([
  ['public/brand/super-ii-social-card.png', [1200, 630]],
  ['public/brand/super-ii-social-card-ru.png', [1698, 952]],
  ['public/brand/super-ii-social-card-zh-cn.png', [1200, 630]],
  ['public/brand/apple-touch-icon.png', [180, 180]],
  ['public/brand/super-ii-icon-192.png', [192, 192]],
  ['public/brand/super-ii-icon-512.png', [512, 512]],
  ['public/brand/super-ii-icon-maskable-512.png', [512, 512]],
  ['public/favicon-16.png', [16, 16]],
  ['public/favicon-32.png', [32, 32]],
]);

for (const [relativePath, [expectedWidth, expectedHeight]] of expectedPngs) {
  const { width, height, bytes } = pngDimensions(relativePath);
  assert(width === expectedWidth && height === expectedHeight, `${relativePath} is ${width}x${height}, expected ${expectedWidth}x${expectedHeight}`);
  assert(bytes > 0, `${relativePath} is empty`);
}

for (const relativePath of [
  'public/brand/super-ii-social-card.png',
  'public/brand/super-ii-social-card-ru.png',
  'public/brand/super-ii-social-card-zh-cn.png',
]) {
  const socialCard = pngDimensions(relativePath);
  assert(socialCard.bytes < 5 * 1024 * 1024, `${relativePath} must remain below 5 MB`);
}

const russianSocialCardHash = createHash('sha256')
  .update(read('public/brand/super-ii-social-card-ru.png'))
  .digest('hex');
assert(
  russianSocialCardHash === '64425a0b52be1a8884b200de9fce98f840f0ca7491d4050d99d2a55cf53b6843',
  'the Russian social card must remain the approved supplied image',
);

const chineseSocialCardHash = createHash('sha256')
  .update(read('public/brand/super-ii-social-card-zh-cn.png'))
  .digest('hex');
assert(
  chineseSocialCardHash === '24e00e20d97478bfb49300359973ac2e64c3c850637af79e27041a56c0e3fb3f',
  'the Simplified Chinese social card must remain the approved Super ii artwork',
);

const favicon = read('public/favicon.ico');
assert(favicon.readUInt16LE(0) === 0 && favicon.readUInt16LE(2) === 1, 'favicon.ico has an invalid ICO header');
assert(favicon.readUInt16LE(4) >= 4, 'favicon.ico must contain at least 16, 32, 48, and 64 px entries');

const layout = read('src/layouts/BaseLayout.astro').toString('utf8');
const requiredLayoutSnippets = [
  'const defaultSocialCards = {',
  "image: '/brand/super-ii-social-card.png'",
  "image: '/brand/super-ii-social-card-ru.png'",
  "image: '/brand/super-ii-social-card-zh-cn.png'",
  'image: requestedImage = defaultSocialCard.image',
  'imageAlt: requestedImageAlt = defaultSocialCard.alt',
  'imageWidth: requestedImageWidth = defaultSocialCard.width',
  'imageHeight: requestedImageHeight = defaultSocialCard.height',
  "const image = locale === 'zh-CN' ? defaultSocialCard.image : requestedImage",
  "const imageAlt = locale === 'zh-CN' ? defaultSocialCard.alt : requestedImageAlt",
  "const imageWidth = locale === 'zh-CN' ? defaultSocialCard.width : requestedImageWidth",
  "const imageHeight = locale === 'zh-CN' ? defaultSocialCard.height : requestedImageHeight",
  'property="og:image:secure_url"',
  'property="og:image:type"',
  'property="og:image:width"',
  'property="og:image:height"',
  'property="og:image:alt"',
  'name="twitter:card" content="summary_large_image"',
  'name="twitter:image:alt"',
  'href="/favicon-32.png"',
  'href="/favicon-16.png"',
  'href="/brand/apple-touch-icon.png"',
];

for (const snippet of requiredLayoutSnippets) {
  assert(layout.includes(snippet), `BaseLayout.astro is missing ${snippet}`);
}

assert(!layout.includes("image = '/brand/super-ii-logo.png'"), 'the padded square logo must not be the default social card');

const manifest = JSON.parse(read('public/site.webmanifest').toString('utf8'));
const manifestIcons = new Set(manifest.icons?.map((icon) => `${icon.src}|${icon.sizes}|${icon.purpose}`));
for (const expected of [
  '/brand/super-ii-icon-192.png|192x192|any',
  '/brand/super-ii-icon-512.png|512x512|any',
  '/brand/super-ii-icon-maskable-512.png|512x512|maskable',
]) {
  assert(manifestIcons.has(expected), `site.webmanifest is missing ${expected}`);
}

console.log('Social metadata check passed: English, Russian, and Simplified Chinese share cards, locale-specific Open Graph/X tags, and multi-size Super ii icons.');
