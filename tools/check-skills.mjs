#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MAX_SKILL_PROMPT_LENGTH,
  mergeSkillsCatalog,
  PACKAGED_SKILL_COUNT,
  parsePublicSkillsCatalog,
  parseSkillsCatalog,
  SKILLS_SOURCE_URL,
} from '../src/lib/skills.ts';

const root = resolve(import.meta.dirname, '..');
const paths = {
  page: 'src/pages/skills.astro',
  client: 'src/scripts/skills-page.ts',
  api: 'src/pages/api/skills.ts',
  catalog: 'src/lib/skills.ts',
  additions: 'src/content/skills-additions.json',
  importer: 'tools/import-skills-library.mjs',
  header: 'src/components/Header.astro',
  footer: 'src/components/Footer.astro',
  homepage: 'src/pages/index.astro',
  signUp: 'src/pages/sign-up.astro',
  signIn: 'src/pages/sign-in.astro',
  styles: 'src/styles/global.css',
  routes: 'src/content/site.json',
  sitemap: 'public/sitemap.xml',
  docs: 'src/pages/docs.astro',
  machineDocs: 'src/pages/llms-full.txt.ts',
  compactDocs: 'public/llms.txt',
  openapi: 'src/pages/openapi.json.ts',
  privacy: 'src/pages/legal/privacy.astro',
};

const files = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')]),
));
const additionsJson = JSON.parse(files.additions);

const errors = [];
const requireText = (file, text) => {
  if (!files[file].includes(text)) errors.push(`${paths[file]} is missing ${text}`);
};
const rejectText = (file, text) => {
  if (files[file].includes(text)) errors.push(`${paths[file]} must not contain ${text}`);
};

for (const text of [
  'Ready-to-use skills for your AI agent.',
  'data-skills-search',
  'data-skills-filters',
  'data-skills-grid',
  'data-skill-window',
  'Complete prompt',
  'Works with any agent',
  'data-skill-window-copy',
  'data-skill-window-share',
  'data-skill-window-play',
  'data-skill-launcher',
  'data-skill-launcher-tab="chat"',
  'data-skill-launcher-tab="code"',
  'Do not enter passwords, API keys, or private keys.',
  '<SuperAssistant />',
]) requireText('page', text);
for (const forbidden of ['contributor', 'sourceUrl', 'detailUrl', 'View source', 'data-skill-window-setup', 'Prompt Factory']) rejectText('page', forbidden);

for (const text of [
  "fetch('/api/skills'",
  'skill.tags ?? []',
  'skill.bestWith ?? []',
  'dialog.showModal()',
  'navigator.clipboard.writeText(value)',
  'navigator.share(shareData)',
  "url.searchParams.set('skill', skill.slug)",
  "new URL(document.URL).searchParams.get('skill')",
  'if (requestedSkill) openSkill(requestedSkill)',
  'data-skill-launcher-tab',
  'DIRECT_PROMPT_LIMIT = 3_500',
  "mode: 'copy'",
  "mode: 'deeplink'",
  'showVariableForm(target, variables)',
  'substituteVariables(activeSkill, new FormData(launcherVariables))',
  'window.localStorage.setItem(LAST_TARGET_KEY, target.id)',
  'window.requestAnimationFrame(positionLauncher)',
  "normalizeName(activeSkill.category) === 'vibe coding'",
  "ui('First get'",
  'programMark(name)',
]) requireText('client', text);
for (const forbidden of ['eval(', 'superii:skill-setup', 'data-skill-window-setup', 'Prompt Factory']) rejectText('client', forbidden);

for (const text of [
  'SKILLS_SOURCE_URL',
  'parseSkillsCatalog',
  'mergeSkillsCatalog',
  'parsePublicSkillsCatalog',
  'FRESH_SECONDS = 300',
  'STALE_SECONDS = 86_400',
  'caches as CacheStorage & { default: Cache }',
  "redirect: 'manual'",
  "'x-superii-skills-cache': state",
  "return publicResponse(cached.body, 'stale')",
  'unified-skills-v2',
]) requireText('api', text);
for (const forbidden of ['sqlClient', 'DATABASE_URL', 'contributor:', 'sourceUrl:', 'detailUrl:']) rejectText('api', forbidden);

for (const text of [
  "SKILLS_SOURCE_URL = 'https://smavgs.github.io/make-great-agents/api/agents.json'",
  'MAX_SKILL_PROMPT_LENGTH = 40_000',
  'parsePublicSkillsCatalog',
  'mergeSkillsCatalog',
  'names.has(normalizedName)',
  'tags?: string[]',
  'variables?: SkillVariable[]',
  'bestWith?: string[]',
  'prompt: entry.prompt',
]) requireText('catalog', text);

for (const text of ['createHash', 'slugify', '40_000', 'writeFile(outputPath']) requireText('importer', text);
if (additionsJson.version !== 1 || !Array.isArray(additionsJson.skills) || additionsJson.skills.length !== 121) {
  errors.push('packaged Skills additions must contain exactly 121 validated entries');
}
if (new Set(additionsJson.skills?.map((skill) => skill.slug)).size !== 121) errors.push('packaged Skills additions must have unique slugs');
if (additionsJson.skills?.some((skill) => 'source' in skill || 'collection' in skill)) errors.push('packaged Skills must not expose a separate source or collection label');

requireText('header', "{ href: '/skills', label: 'Skills' }");
requireText('footer', '<a href="/skills">Skills</a>');
for (const text of [
  '<section class="skills-home-hook">',
  'Skills · Included from Free',
  'Give your AI agent a useful job.',
  'Explore Skills',
  'share it with someone',
  'const skillsCtaUrl = isSignedIn',
  'href={skillsCtaUrl}',
  "`/sign-up?redirect_url=${encodeURIComponent('/skills')}`",
  'Copy any prompt. Use any agent. No lock-in.',
]) requireText('homepage', text);
for (const removed of ['The hub is open', 'Publish a reviewed release.']) rejectText('homepage', removed);
for (const page of ['signUp', 'signIn']) {
  requireText(page, "const skillsRedirect = '/skills'");
  requireText(page, 'skillsRedirect,');
}

for (const selector of [
  '.skills-home-hook', '.skills-page', '.skills-hero', '.skills-search', '.skills-filters',
  '.skills-grid', '.skill-card', '.skill-card__requirements', '.program-mark', '.skill-window',
  '.skill-window__requirements', '.skill-window__share', '.skill-window__play', '.skill-launcher',
  '.skill-launch-target', '.skill-launcher__variables',
]) requireText('styles', selector);
requireText('styles', 'grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr))');
requireText('styles', 'background: #15803d');
requireText('styles', '.skill-launcher__handoff > div:has(a[hidden]) button');
requireText('styles', '@media (prefers-reduced-motion: reduce)');
for (const peach of ['#fff0e7', '#ffe2d3', '#ffc6ad', '#fb9873', '#dc6648']) requireText('styles', peach);

requireText('routes', '"/skills"');
requireText('routes', '"/api/skills"');
requireText('sitemap', 'https://superii.site/skills');
requireText('docs', 'id="skills"');
requireText('docs', '<strong>Play</strong>');
requireText('docs', 'one unified catalog');
requireText('docs', 'removes exact slug or name collisions');
rejectText('docs', 'No second skills database is maintained.');
requireText('machineDocs', '## Skills library');
requireText('machineDocs', 'choose Play');
requireText('machineDocs', 'optional');
requireText('compactDocs', '[Skills](https://superii.site/skills)');
requireText('compactDocs', '[Skills catalog API](https://superii.site/api/skills)');
requireText('openapi', "'/api/skills'");
requireText('openapi', "operationId: 'listAgentSkills'");
requireText('openapi', 'maxLength: 40000');
requireText('openapi', 'bestWith:');
requireText('privacy', 'Skills Play is a browser-side handoff.');
requireText('privacy', 'Do not enter passwords, API keys, private keys');

const prompt = '  Keep this complete prompt exactly as written.  ';
const valid = parseSkillsCatalog({
  version: 1,
  agents: [{
    slug: 'test-skill',
    name: 'Test Skill',
    category: 'Ops',
    integrations: ['Codex'],
    prompt,
    tags: ['Testing'],
    variables: [{ name: 'topic', default: '' }],
    bestWith: ['gpt-test'],
    contributor: { ignored: true },
    sourceUrl: 'https://example.com/ignored',
  }],
});
if (!valid || valid.skills[0]?.prompt !== prompt) errors.push('catalog parser must preserve the complete prompt exactly');
if (!valid || valid.skills[0]?.variables?.[0]?.name !== 'topic' || valid.skills[0]?.tags?.[0] !== 'Testing') {
  errors.push('catalog parser must preserve valid optional Skills fields');
}
if (valid && Object.keys(valid.skills[0]).sort().join(',') !== 'bestWith,category,integrations,name,prompt,slug,tags,variables') {
  errors.push('normalized API skill exposes unexpected fields');
}
if (parseSkillsCatalog({ version: 1, agents: [
  { slug: 'same', name: 'One', category: 'Ops', integrations: [], prompt: 'One' },
  { slug: 'same', name: 'Two', category: 'Ops', integrations: [], prompt: 'Two' },
] })) errors.push('catalog parser must reject duplicate slugs');
if (parseSkillsCatalog({ version: 1, agents: [{ slug: '../bad', name: 'Bad', category: 'Ops', integrations: [], prompt: 'Bad' }] })) {
  errors.push('catalog parser must reject invalid slugs');
}
if (parseSkillsCatalog({ version: 1, agents: [{
  slug: 'bad-variable', name: 'Bad variable', category: 'Ops', integrations: [], prompt: 'Bad',
  variables: [{ name: '../secret', default: '' }],
}] })) errors.push('catalog parser must reject invalid variable names');
if (parseSkillsCatalog({ version: 1, agents: [{
  slug: 'too-long', name: 'Too long', category: 'Ops', integrations: [], prompt: 'x'.repeat(MAX_SKILL_PROMPT_LENGTH + 1),
}] })) errors.push('catalog parser must reject prompts above the documented limit');
if (PACKAGED_SKILL_COUNT !== 121 || !parsePublicSkillsCatalog(additionsJson)) errors.push('packaged Skills additions must parse through the public schema');
if (!valid || mergeSkillsCatalog(valid).skills.length !== PACKAGED_SKILL_COUNT + 1) errors.push('unified catalog must include upstream and packaged Skills');
if (SKILLS_SOURCE_URL !== 'https://smavgs.github.io/make-great-agents/api/agents.json') errors.push('refreshed open-source catalog URL drifted');

if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

console.log('OK: Skills serves one validated catalog, 121 packaged additions, First get program marks, portable Copy and Share, and an adaptive green Play handoff with variables and safe clipboard fallbacks.');
