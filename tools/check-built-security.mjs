import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function filesBelow(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${directory}${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(`${relative}/`));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const clientFiles = await filesBelow('dist/client/');
const staticHtml = clientFiles.filter((path) => path.endsWith('.html'));
assert.deepEqual(
  staticHtml,
  [],
  'HTML must remain server-rendered so Astro middleware can issue a fresh CSP nonce per response',
);

for (const path of [
  'dist/client/_headers',
  'dist/client/.well-known/agent-card.json',
  'dist/client/agent-connectors.json',
  'dist/client/docs.json',
  'dist/client/llms-full.txt',
  'dist/client/openapi.json',
]) {
  assert.ok(clientFiles.includes(path), `expected immutable static machine resource: ${path}`);
}

const middlewareBundle = await readFile(new URL('dist/server/virtual_astro_middleware.mjs', root), 'utf8');
assert.match(middlewareBundle, /getRandomValues\([\s\S]{0,80}new Uint8Array\(16\)\)/);
assert.match(middlewareBundle, /new HTMLRewriter\(\)/);
assert.match(middlewareBundle, /setAttribute\("nonce", nonce\)/);
assert.ok(!middlewareBundle.includes("script-src 'self' 'unsafe-inline' https:"));
assert.ok(!middlewareBundle.includes("connect-src 'self' https: wss:"));

console.log('Built security check: no static HTML bypass and nonce middleware present in release bundle');
