import fs from 'node:fs';
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

const socialCard = pngDimensions('public/brand/super-ii-social-card.png');
assert(socialCard.bytes < 5 * 1024 * 1024, 'social card must remain below 5 MB');

const favicon = read('public/favicon.ico');
assert(favicon.readUInt16LE(0) === 0 && favicon.readUInt16LE(2) === 1, 'favicon.ico has an invalid ICO header');
assert(favicon.readUInt16LE(4) >= 4, 'favicon.ico must contain at least 16, 32, 48, and 64 px entries');

const layout = read('src/layouts/BaseLayout.astro').toString('utf8');
const requiredLayoutSnippets = [
  "image = '/brand/super-ii-social-card.png'",
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

console.log('Social metadata check passed: 1200x630 share card, structured Open Graph/X tags, and multi-size Super ii icons.');
