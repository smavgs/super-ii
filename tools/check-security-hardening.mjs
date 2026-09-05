import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  catalogSearchInputSchema,
  catalogSearchWithKindSchema,
  parseCatalogRestSearchParams,
} from '../src/lib/catalog-search.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function parseDirective(policy, name) {
  const directive = policy
    .split(';')
    .map((value) => value.trim())
    .find((value) => value === name || value.startsWith(`${name} `));
  assert.ok(directive, `missing ${name} directive`);
  return directive.split(/\s+/).slice(1);
}

function expectInvalid(query, path) {
  const result = parseCatalogRestSearchParams(new URLSearchParams(query));
  assert.equal(result.success, false, `expected invalid query: ${query}`);
  assert.ok(result.issues.some((issue) => issue.path === path), `expected ${path} issue for: ${query}`);
}

const valid = parseCatalogRestSearchParams(new URLSearchParams([
  'kind=dataset',
  'q=public+data',
  'task=classification',
  'library=transformers',
  'license=apache-2.0',
  'modality=text',
  'author=builder',
  'max_size=9007199254740991',
  'updated_after=2026-09-04',
  'hardware=apple-silicon',
  'os=macos',
  'max_ram_bytes=0',
  'max_vram_bytes=24',
  'sort=updated',
  'limit=50',
  'offset=100',
].join('&')));
assert.equal(valid.success, true);
if (valid.success) {
  assert.equal(valid.data.kind, 'dataset');
  assert.equal(valid.data.limit, 50);
  assert.equal(valid.data.offset, 100);
  assert.equal(valid.data.filters.query, 'public data');
  assert.equal(valid.data.filters.hardware, 'apple-silicon');
  assert.equal(valid.data.filters.maxSizeBytes, Number.MAX_SAFE_INTEGER);
}

const defaulted = parseCatalogRestSearchParams(new URLSearchParams('kind=model'));
assert.equal(defaulted.success, true);
if (defaulted.success) {
  assert.equal(defaulted.data.limit, 20);
  assert.equal(defaulted.data.offset, 0);
}

for (const value of ['0', '51', '-1', '1.5', '1e3', '999999999']) {
  expectInvalid(`kind=model&limit=${encodeURIComponent(value)}`, 'limit');
}
for (const value of ['-1', '101', '1.5', '1e3', '999999999']) {
  expectInvalid(`kind=model&offset=${encodeURIComponent(value)}`, 'offset');
}
expectInvalid('', 'kind');
expectInvalid('kind=unknown', 'kind');
expectInvalid('kind=model&sort=%3BDROP', 'sort');
expectInvalid('kind=model&hardware=quantum', 'hardware');
expectInvalid('kind=model&os=ios', 'os');
expectInvalid('kind=model&updated_after=yesterday', 'updated_after');
expectInvalid('kind=model&updated_after=2026-02-30', 'updated_after');
expectInvalid('kind=model&max_size=-1', 'max_size');
expectInvalid('kind=model&max_ram_bytes=1.5', 'max_ram_bytes');
expectInvalid('kind=model&max_vram_bytes=9007199254740992', 'max_vram_bytes');
expectInvalid('kind=model&unknown=value', 'unknown');
expectInvalid('kind=model&kind=space', 'kind');
expectInvalid('kind=model&q=one&q=two', 'q');
expectInvalid(`kind=model&q=${'x'.repeat(301)}`, 'q');
expectInvalid(`kind=model&author=${'x'.repeat(121)}`, 'author');

assert.equal(catalogSearchInputSchema.safeParse({ limit: 1 }).success, true);
assert.equal(catalogSearchInputSchema.safeParse({ limit: 50 }).success, true);
assert.equal(catalogSearchInputSchema.safeParse({ limit: 0 }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ limit: 51 }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ limit: 1.5 }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ sort: ';DROP' }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ hardware: 'invalid' }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ updated_after: 'bad-date' }).success, false);
assert.equal(catalogSearchInputSchema.safeParse({ unexpected: true }).success, false);
assert.equal(catalogSearchWithKindSchema.safeParse({ kind: 'space' }).success, true);
assert.equal(catalogSearchWithKindSchema.safeParse({ kind: 'invalid' }).success, false);

const [middleware, astroConfig, staticHeaders, searchRoute, healthRoute, mcpServer, a2a, catalog, openapi, siteModule] = await Promise.all([
  read('src/middleware.ts'),
  read('astro.config.mjs'),
  read('public/_headers'),
  read('src/pages/api/search.ts'),
  read('src/pages/api/health.ts'),
  read('src/lib/mcp-server.ts'),
  read('src/lib/a2a.ts'),
  read('src/lib/catalog.ts'),
  read('src/pages/openapi.json.ts'),
  read('src/lib/site.ts'),
]);

const policyLine = staticHeaders.split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:'));
assert.ok(policyLine, 'public/_headers must define Content-Security-Policy');
const staticPolicy = policyLine.slice(policyLine.indexOf(':') + 1).trim();
const scriptSources = parseDirective(staticPolicy, 'script-src');
const connectSources = parseDirective(staticPolicy, 'connect-src');
assert.ok(!scriptSources.includes("'unsafe-inline'"), 'normal script-src must not allow unsafe-inline');
assert.ok(!scriptSources.includes('https:'), 'normal script-src must not allow every HTTPS origin');
assert.ok(scriptSources.includes("'wasm-unsafe-eval'"), 'browser inference requires bounded WebAssembly compilation');
assert.ok(scriptSources.includes('https://clerk.superii.site'), 'Clerk frontend API must remain available');
assert.ok(scriptSources.includes('https://challenges.cloudflare.com'), 'Cloudflare challenges must remain available');
assert.ok(!connectSources.includes('https:'), 'connect-src must not allow every HTTPS origin');
assert.ok(!connectSources.includes('wss:'), 'connect-src must not allow every secure WebSocket origin');
assert.deepEqual(parseDirective(staticPolicy, 'script-src-attr'), ["'none'"]);

assert.match(middleware, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
assert.match(middleware, /'nonce-\$\{nonce\}'/);
assert.match(middleware, /"'strict-dynamic'"/);
assert.match(middleware, /new HTMLRewriter\(\)/);
assert.match(middleware, /element\.setAttribute\('nonce', nonce\)/);
assert.match(middleware, /href\.includes\('\/npm\/@clerk\/ui@'\)[\s\S]+element\.remove\(\)/);
assert.match(middleware, /inlineMediaFrame[\s\S]+default-src 'none'; frame-ancestors 'self'/);
assert.ok(!middleware.includes('content-security-policy-report-only'), 'strict CSP must be enforced after observation');
assert.ok(!middleware.includes("script-src 'self' 'unsafe-inline' https:"), 'legacy observation policy must be removed');
assert.ok(!astroConfig.includes('prefetchAll'), 'Cloudflare Worker routes must not use unsupported global page prefetching');
assert.ok(!astroConfig.includes('prefetchUI: false'), 'Clerk modal UI must remain available on demand');

assert.match(searchRoute, /parseCatalogRestSearchParams\(url\.searchParams\)/);
assert.match(searchRoute, /consumeRateLimit\(locals, request, sql, 'catalog\.search', 300, 3600\)/);
assert.match(searchRoute, /status: 422/);
assert.match(searchRoute, /status: rate === 'limited' \? 429 : 503/);
assert.match(searchRoute, /'retry-after': '3600'/);
assert.match(mcpServer, /catalogSearchInputSchema/);
assert.match(mcpServer, /catalogFiltersFromInput\(input\)/);
assert.match(a2a, /catalogSearchWithKindSchema/);
assert.match(a2a, /catalogFiltersFromInput\(input\)/);
assert.match(catalog, /Math\.min\(Math\.max\(limit, 1\), 50\)/);
assert.match(catalog, /Math\.min\(Math\.max\(offset, 0\), 100\)/);

for (const leaked of ['service:', 'version:', 'checks:', 'timestamp:']) {
  assert.ok(!healthRoute.includes(leaked), `/api/health must not expose ${leaked.slice(0, -1)}`);
}
assert.match(healthRoute, /status: healthy \? 'ok' : 'degraded'/);
assert.match(healthRoute, /status: healthy \? 200 : 503/);
assert.match(siteModule, /runtimeEnv\?\.PUBLIC_CLERK_PUBLISHABLE_KEY/);
assert.match(siteModule, /import\.meta\.env\.PUBLIC_CLERK_PUBLISHABLE_KEY/);

assert.match(openapi, /name: 'kind', in: 'query', required: true/);
assert.match(openapi, /name: 'limit'[\s\S]+minimum: 1, maximum: 50, default: 20/);
assert.match(openapi, /name: 'offset'[\s\S]+minimum: 0, maximum: 100, default: 0/);
assert.match(openapi, /'422': \{ description:/);

async function astroPageFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relative = `${directory}${entry.name}`;
    if (entry.isDirectory()) paths.push(...await astroPageFiles(`${relative}/`));
    else if (entry.isFile() && entry.name.endsWith('.astro')) paths.push(relative);
  }
  return paths;
}

for (const path of await astroPageFiles('src/pages/')) {
  const source = await read(path);
  assert.ok(
    !source.includes('export const prerender = true'),
    `${path} must be server-rendered so every HTML response receives a fresh CSP nonce`,
  );
}

console.log('Security hardening check: shared search schema, bounded paging, rate limiting, minimal health, and nonce CSP OK');
