#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const catalog = JSON.parse(await read('src/content/robot-catalog.json'));
const errors = [];
const requiredEvidence = new Set(['verified','declared','derived','unknown']);
const slugs = new Set(catalog.components.map((component) => component.slug));

if (catalog.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(catalog.catalogRevision)) errors.push('Robot catalogue version is invalid');
if (catalog.components.length < 6 || slugs.size !== catalog.components.length) errors.push('Robot components must be substantial and uniquely named');
if (new Set(catalog.evidenceStates.map((state) => state.id)).size !== 4 || catalog.evidenceStates.some((state) => !requiredEvidence.has(state.id))) errors.push('Robot evidence state ladder is incomplete');
for (const component of catalog.components) {
  if (!requiredEvidence.has(component.evidenceStatus)) errors.push(`${component.slug} has invalid evidence status`);
  if (!component.sources?.length || component.sources.some((source) => !source.url.startsWith('https://') || !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt))) errors.push(`${component.slug} lacks bounded HTTPS source evidence`);
  if (!Array.isArray(component.unknowns)) errors.push(`${component.slug} does not expose unknowns`);
}
for (const claim of catalog.compatibility) {
  if (!slugs.has(claim.left) || !slugs.has(claim.right)) errors.push(`compatibility references unknown component ${claim.left}/${claim.right}`);
  if (!requiredEvidence.has(claim.status) || !claim.sourceUrl?.startsWith('https://')) errors.push(`compatibility claim ${claim.left}/${claim.right} lacks evidence`);
}
const reference = catalog.referenceRobots?.find((robot) => robot.slug === 'rover-one');
if (!reference || !reference.variants.some((variant) => variant.id === 'pi5') || !reference.variants.some((variant) => variant.id === 'jetson')) errors.push('Rover One must expose Pi 5 and Jetson paths');
if (!/never.+pay/i.test(`${catalog.rankingPolicy} ${catalog.commercial?.ranking}`)) errors.push('compatibility ranking must explicitly reject pay-to-win');
if (/\$\d|buy now|add to cart/i.test(JSON.stringify(catalog))) errors.push('component catalogue must not claim procurement or volatile prices');

const requiredFiles = [
  'src/lib/robot.ts','src/lib/robot-store.ts','src/lib/robot-mcp-server.ts','src/lib/robot-a2a.ts','src/lib/robot-openapi.ts',
  'src/pages/robot/index.astro','src/pages/robot/components/[slug].astro','src/pages/robot/[owner]/[slug].astro','src/pages/robot/agents.md.ts',
  'src/pages/mcp/robot.ts','src/pages/.well-known/robot-agent-card.json.ts','src/pages/a2a/robot/v1/[...operation].ts',
  'src/pages/api/robot/components/index.ts','src/pages/api/robot/plan.ts','src/pages/api/robot/robots/index.ts',
  'src/pages/api/robot/hardware/index.ts','src/components/RobotWorkspace.astro','database/migrations/0019_robot_foundation.sql','database/tests/robot_smoke.sql',
];
for (const file of requiredFiles) { try { if (!(await stat(resolve(root, file))).isFile()) errors.push(`missing Robot file ${file}`); } catch { errors.push(`missing Robot file ${file}`); } }

const sources = Object.fromEntries(await Promise.all([
  'src/lib/robot.ts','src/lib/robot-mcp-server.ts','src/lib/robot-a2a.ts','src/lib/work-mcp-server.ts','src/lib/agent-auth.ts',
  'src/pages/robot/index.astro','src/scripts/robot-page.ts','src/components/RobotWorkspace.astro','src/components/Header.astro','src/components/Footer.astro',
  'src/middleware.ts','src/lib/i18n.ts','database/migrations/0019_robot_foundation.sql','src/pages/openapi.json.ts','src/pages/llms-full.txt.ts',
].map(async (file) => [file, await read(file)])));
const combined = Object.values(sources).join('\n');
for (const marker of ['makeRobotPlan','safety_approval: false','Robot Check','/mcp/robot','robot:read','robot:create','robot:update','agent_create_robot_with_receipt','robot_versions_are_immutable','robot_private_requires_pro','robot_team_owner_requires_team','record_robot_discovery']) {
  if (!combined.includes(marker)) errors.push(`Robot contract marker missing: ${marker}`);
}
if (!sources['src/components/Header.astro'].includes("href: '/robot'")) errors.push('primary navigation does not expose Robot');
if (!sources['src/components/Footer.astro'].includes('href="/robot"')) errors.push('footer does not expose Robot');
if (!sources['src/pages/robot/index.astro'].includes('Raspberry Pi first') || !sources['src/pages/robot/index.astro'].includes('never pay-to-win')) errors.push('Robot thesis or ranking promise missing');
if ((sources['src/scripts/robot-page.ts'].match(/saveForm\?\.addEventListener\('submit'/g) ?? []).length !== 1 || !sources['src/scripts/robot-page.ts'].includes('planner_input: currentPlan.input') || !sources['src/scripts/robot-page.ts'].includes("organization_id: data.get('organization_id') || null")) errors.push('Robot save flow must have one canonical personal or Team immutable-version submission');
if (!sources['src/middleware.ts'].includes('hasLocalizedPage') || !sources['src/middleware.ts'].includes('englishOnly')) errors.push('English-only canonical localization guard is missing');
const rootsMatch = sources['src/lib/i18n.ts'].match(/const localizableRoots = new Set\(\[([\s\S]*?)\]\);/);
if (!rootsMatch || /['"]robot['"]/.test(rootsMatch[1])) errors.push('Robot must not be registered as a localized human route yet');
if (!/max-width:\s*620px/.test(await read('src/styles/robot.css'))) errors.push('Robot layout lacks narrow viewport treatment');
if (!sources['src/pages/openapi.json.ts'].includes('robotApiPaths')) errors.push('OpenAPI does not expose Robot REST/A2A paths');
if (!sources['src/pages/llms-full.txt.ts'].includes('## Super ii Robot')) errors.push('full machine guide lacks Robot contract');
const sitemap = await read('public/sitemap.xml');
if (!sitemap.includes('<loc>https://superii.site/robot</loc>') || !sitemap.includes('<loc>https://superii.site/robot/components/raspberry-pi-5</loc>')) errors.push('English Robot discovery pages are missing from the sitemap');
if (sitemap.includes('<loc>https://superii.site/ru/robot')) errors.push('Robot must not have a Russian sitemap entry in this release');

if (errors.length) { errors.forEach((error) => console.error(`ERROR: ${error}`)); process.exit(1); }
console.log(`OK: ${catalog.components.length} source-backed components, ${catalog.compatibility.length} explicit compatibility claims, Pi/Jetson Rover One, English-only UI, Free/Pro/Team gates, REST/MCP/A2A and immutable agent work verified`);
