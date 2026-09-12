#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  TRANSPARENT_CRITERIA_VERSION,
  checkHuggingFaceTransparency,
  compareTransparencyReports,
  parseTransparencySource,
} from '../src/lib/transparent.ts';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const expect = (condition, message) => { if (!condition) errors.push(message); };
const requiredFiles = [
  'src/lib/transparent.ts', 'src/lib/transparent-store.ts', 'src/lib/transparent-mcp-server.ts',
  'src/pages/transparent/index.astro', 'src/pages/transparent/[reportKey].astro', 'src/pages/transparent/agents.md.ts',
  'src/pages/mcp/transparent.ts', 'src/pages/api/transparent/check.ts', 'src/pages/api/transparent/compare.ts',
  'src/pages/api/transparent/reports/index.ts', 'src/pages/api/transparent/reports/[reportKey]/index.ts',
  'src/pages/api/transparent/reports/[reportKey]/recheck.ts', 'src/pages/api/transparent/reports/[reportKey]/save.ts',
  'src/pages/api/transparent/reports/[reportKey]/watch.ts', 'src/pages/api/transparent/reports/[reportKey]/claim.ts',
  'src/pages/api/transparent/reports/[reportKey]/response.ts', 'src/pages/api/transparent/reports/[reportKey]/evidence.ts',
  'src/components/TransparencyChecker.astro', 'src/components/TransparencyWorkspace.astro', 'src/styles/transparent.css',
  'src/lib/transparent-openapi.ts', 'docs/architecture/transparent.md',
  'public/brand/super-ii-transparent-card.svg', 'public/brand/super-ii-transparent-card.png',
  'database/migrations/0020_transparent_foundation.sql', 'database/tests/transparent_smoke.sql',
];
for (const file of requiredFiles) {
  try { expect((await stat(resolve(root, file))).isFile(), `missing Transparent file ${file}`); }
  catch { errors.push(`missing Transparent file ${file}`); }
}

const accepted = [
  ['https://huggingface.co/owner/model/tree/abc123', 'model', 'owner/model', 'abc123'],
  ['https://www.huggingface.co/datasets/owner/data/blob/0123456789012345678901234567890123456789/README.md', 'dataset', 'owner/data', '0123456789012345678901234567890123456789'],
  ['spaces/owner/app', 'space', 'owner/app', 'main'],
  ['owner/model', 'model', 'owner/model', 'main'],
];
for (const [input, kind, id, revision] of accepted) {
  try {
    const parsed = parseTransparencySource(input);
    expect(parsed.kind === kind && parsed.repositoryId === id && parsed.requestedRevision === revision, `source parser mismatch for ${input}`);
  } catch { errors.push(`valid source rejected: ${input}`); }
}
for (const input of [
  'http://huggingface.co/owner/model', 'https://evil.test/owner/model', 'https://huggingface.co/owner',
  'https://huggingface.co/api/models/owner/model', 'https://huggingface.co/owner/model/resolve/main/file',
  'https://huggingface.co/owner/%2e%2e', 'https://user:pass@huggingface.co/owner/model',
]) {
  let rejected = false;
  try { parseTransparencySource(input); } catch { rejected = true; }
  expect(rejected, `unsafe or unsupported source accepted: ${input}`);
}

const originalFetch = globalThis.fetch;
const calls = [];
const revision = '1234567890abcdef1234567890abcdef12345678';
const metadata = {
  id: 'owner/model', sha: revision, private: false, gated: false,
  lastModified: '2026-09-12T00:00:00.000Z', pipeline_tag: 'text-generation',
  cardData: { license: 'mit', language: ['en'], datasets: ['owner/data'], base_model: 'owner/base', metrics: ['accuracy'] },
  safetensors: { total: 123456 },
  siblings: [
    { rfilename: 'README.md', size: 220, blobId: 'a' },
    { rfilename: 'config.json', size: 50, blobId: 'b' },
    { rfilename: 'LICENSE', size: 40, blobId: 'c' },
    { rfilename: 'model.safetensors', size: 1000, lfs: { sha256: 'a'.repeat(64) } },
  ],
};
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.toString());
  if (url.pathname.startsWith('/api/models/')) return Response.json(metadata);
  if (url.pathname.endsWith('/README.md')) return new Response('# Intended use\nFor tests.\n# Limitations\nTest only.\n# Evaluation\naccuracy\n# Risks\nUnknown.');
  if (url.pathname.endsWith('/config.json')) return Response.json({ architectures: ['FixtureModel'] });
  return new Response('not found', { status: 404 });
};
try {
  const report = await checkHuggingFaceTransparency({ source: 'https://huggingface.co/owner/model' });
  expect(report.criteria_version === TRANSPARENT_CRITERIA_VERSION, 'criteria version mismatch');
  expect(report.repository.resolved_revision === revision, 'exact revision was not pinned');
  expect(report.evidence.length >= 20, 'model report is not substantial');
  expect(report.coverage.by_state.verified > 0 && report.coverage.by_state.declared > 0 && report.coverage.by_state.derived > 0 && report.coverage.by_state.unknown > 0, 'four-state evidence output is incomplete');
  expect(report.evidence.find((item) => item.id === 'parameter-count')?.method?.includes('safetensors.total'), 'derived parameter method missing');
  expect(report.limitations.some((value) => /did not execute/i.test(value)), 'no-execution boundary missing');
  expect(calls.every((value) => new URL(value).hostname === 'huggingface.co'), 'checker left the Hugging Face allowlist');
  expect(calls.filter((value) => !value.includes('/api/models/')).every((value) => value.includes(revision)), 'evidence file was not commit-pinned');
  const sameRevision = await checkHuggingFaceTransparency({ source: 'owner/model' });
  expect(sameRevision.report_key === report.report_key, 'same revision did not produce stable report key');
  const changed = structuredClone(report);
  changed.report_key = 'f'.repeat(64);
  changed.repository.resolved_revision = '2'.repeat(40);
  changed.evidence[0].value = changed.repository.resolved_revision;
  expect(compareTransparencyReports(report, changed).changed_count === 1, 'exact report comparison did not isolate changed evidence');
} catch (error) {
  errors.push(`fixture Transparency Check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  globalThis.fetch = originalFetch;
}

const sourceFiles = Object.fromEntries(await Promise.all([
  'src/lib/transparent.ts', 'src/lib/transparent-store.ts', 'src/lib/transparent-mcp-server.ts',
  'src/pages/transparent/[reportKey].astro', 'src/pages/bring-my-work.astro', 'src/pages/index.astro',
  'src/pages/account.astro', 'src/components/Footer.astro', 'src/lib/agent-auth.ts', 'database/migrations/0020_transparent_foundation.sql',
  'src/pages/openapi.json.ts', 'src/lib/transparent-openapi.ts', 'src/pages/docs.astro', 'src/pages/docs.json.ts',
  'src/pages/llms-full.txt.ts', 'src/pages/agents.md.ts', 'src/pages/siiwebskill.md.ts', 'src/lib/system-state.ts',
  'SYSTEM-STATE.md', 'public/sitemap.xml', 'src/content/site.json',
].map(async (file) => [file, await readFile(resolve(root, file), 'utf8')])));
const combined = Object.values(sourceFiles).join('\n');
for (const marker of [
  'check_huggingface_transparency', 'get_transparency_report', 'compare_huggingface_revisions',
  'search_public_transparency_reports', 'watch_transparency_report', '/mcp/transparent',
  'hf-public-v1.0', 'transparency_evidence_is_immutable', 'advance_transparency_watches',
  'huggingface-oauth-owner-match', 'transparent:watch', 'public evidence only',
  'transparentApiPaths', 'transparentOpenApiSchemas', 'Super ii Transparent architecture',
]) expect(combined.includes(marker), `Transparent contract marker missing: ${marker}`);
expect(sourceFiles['src/pages/index.astro'].indexOf('<TransparencyChecker variant="home"') > sourceFiles['src/pages/index.astro'].indexOf('id="ai-worker-home"'), 'homepage checker is not after AI Worker');
expect(sourceFiles['src/pages/bring-my-work.astro'].indexOf('<TransparencyChecker variant="bridge"') > sourceFiles['src/pages/bring-my-work.astro'].indexOf('Verified arrival'), 'Bridge checker is not after Step 03');
expect(!/fetch\((?:input\.source|source|url)\)/.test(sourceFiles['src/lib/transparent.ts']), 'checker may fetch arbitrary user URL');
expect(/max-width:\s*680px/.test(await readFile(resolve(root, 'src/styles/transparent.css'), 'utf8')), 'Transparent narrow viewport layout missing');
expect(sourceFiles['public/sitemap.xml'].includes('<loc>https://superii.site/transparent</loc>'), 'Transparent public route is missing from sitemap');
expect(!sourceFiles['public/sitemap.xml'].includes('<loc>https://superii.site/ru/transparent'), 'Transparent must remain English-only in this release');
expect(sourceFiles['src/content/site.json'].includes('"/transparent"') && sourceFiles['src/content/site.json'].includes('"/mcp/transparent"'), 'Transparent routes are missing from the site contract');
expect(sourceFiles['SYSTEM-STATE.md'].includes('| Super ii Transparent |'), 'Transparent is missing from the capability register');
expect(sourceFiles['src/pages/docs.astro'].includes('id="transparent"') && sourceFiles['src/pages/docs.json.ts'].includes("id: 'transparent-mcp'"), 'Transparent human or machine documentation is incomplete');
const socialCard = await readFile(resolve(root, 'public/brand/super-ii-transparent-card.png'));
expect(socialCard.length > 20_000 && socialCard.subarray(1, 4).toString('ascii') === 'PNG', 'Transparent social card is not a substantial PNG');

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log('OK: Hugging Face-only exact-revision engine, four evidence states, immutable reports, public REST/MCP, scoped agent watches, acquisition surfaces, claims and responsive UI verified');
