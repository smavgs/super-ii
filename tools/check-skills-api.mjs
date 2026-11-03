import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'superii-skills-api-'));
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const originalError = console.error;
try {
  const outfile = join(temporary, 'skills.mjs');
  await build({ entryPoints: [new URL('../src/pages/api/skills.ts', import.meta.url).pathname], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { GET } = await import(pathToFileURL(outfile).href);
  let cached = null;
  globalThis.caches = { default: { match: async () => cached?.clone(), put: async (_key, response) => { cached = response.clone(); } } };
  console.error = () => {}; // Expected upstream outages are asserted below.
  globalThis.fetch = async () => { throw new Error('test outage'); };
  let response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-superii-skills-cache'), 'packaged');
  assert.equal((await response.json()).skills.length, 1763);

  const prompt = 'Full upstream prompt, including trailing spaces.  ';
  globalThis.fetch = async () => Response.json({ version: 1, agents: [
    { slug: 'upstream-contract-check', name: 'Upstream contract check', category: 'Ops', integrations: [], prompt },
  ] });
  response = await GET();
  assert.equal(response.headers.get('x-superii-skills-cache'), 'fresh');
  const catalog = await response.json();
  assert.equal(catalog.skills.length, 1764);
  assert.equal(catalog.skills[0].prompt, prompt);
  assert.equal(catalog.skills.filter(s => s.source).length, 1642);

  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('test outage'); };
  response = await GET();
  assert.equal(response.headers.get('x-superii-skills-cache'), 'hit');
  assert.equal(fetched, false);
  cached = new Response(JSON.stringify(catalog), { headers: { 'x-superii-skills-fetched-at': String(Date.now() - 360_000) } });
  response = await GET();
  assert.equal(response.headers.get('x-superii-skills-cache'), 'stale');
  assert.equal((await response.json()).skills.length, 1764);
  cached = new Response(JSON.stringify(catalog), { headers: { 'x-superii-skills-fetched-at': String(Date.now() - 90_000_000) } });
  response = await GET();
  assert.equal(response.headers.get('x-superii-skills-cache'), 'packaged');
  assert.equal((await response.json()).skills.length, 1763);
  console.log('OK: Skills API fresh, hit, stale and packaged fallback states preserve the complete expanded catalog without production data.');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
  console.error = originalError;
  await rm(temporary, { recursive: true, force: true });
}
