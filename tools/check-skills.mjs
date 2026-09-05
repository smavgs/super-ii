#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAssistantSkillContext } from '../src/lib/openrouter.ts';
import { parseSkillsCatalog, SKILLS_SOURCE_URL } from '../src/lib/skills.ts';

const root = resolve(import.meta.dirname, '..');
const paths = {
  page: 'src/pages/skills.astro',
  client: 'src/scripts/skills-page.ts',
  api: 'src/pages/api/skills.ts',
  catalog: 'src/lib/skills.ts',
  assistant: 'src/scripts/super-assistant.ts',
  assistantComponent: 'src/components/SuperAssistant.astro',
  assistantApi: 'src/pages/api/assistant/chat.ts',
  openrouter: 'src/lib/openrouter.ts',
  header: 'src/components/Header.astro',
  footer: 'src/components/Footer.astro',
  homepage: 'src/pages/index.astro',
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
  'data-skill-window-setup',
  '<SuperAssistant />',
]) requireText('page', text);

for (const forbidden of ['contributor', 'sourceUrl', 'detailUrl', 'View source']) rejectText('page', forbidden);

for (const text of [
  "fetch('/api/skills'",
  "[skill.name, skill.category, ...skill.integrations, skill.prompt]",
  'dialog.showModal()',
  'navigator.clipboard.writeText(activeSkill.prompt)',
  "new CustomEvent('superii:skill-setup'",
  "document.activeElement !== search",
]) requireText('client', text);
rejectText('client', 'window.location');

for (const text of [
  'SKILLS_SOURCE_URL',
  'parseSkillsCatalog',
  'FRESH_SECONDS = 300',
  'STALE_SECONDS = 86_400',
  'caches as CacheStorage & { default: Cache }',
  "redirect: 'manual'",
  "'x-superii-skills-cache': state",
  "return publicResponse(cached.body, 'stale')",
]) requireText('api', text);
for (const forbidden of ['sqlClient', 'DATABASE_URL', 'contributor:', 'sourceUrl:', 'detailUrl:']) rejectText('api', forbidden);

for (const text of [
  "SKILLS_SOURCE_URL = 'https://smavgs.github.io/make-great-agents/api/agents.json'",
  'slug: entry.slug',
  'name: entry.name.trim()',
  'category: entry.category.trim()',
  'integrations: entry.integrations.map',
  'prompt: entry.prompt',
]) requireText('catalog', text);

for (const text of [
  'openSkillSetup: (context: AssistantSkillContext) => void',
  'skill_context: skillContext',
  'I’ll help you set up ${nextContext.name}',
]) requireText('assistant', text);
requireText('assistantComponent', "window.addEventListener('superii:skill-setup'");
requireText('assistantComponent', 'controller.openSkillSetup(event.detail)');
requireText('assistantApi', 'parseAssistantSkillContext');
requireText('assistantApi', 'invalid skill setup context');
requireText('openrouter', 'Treat the catalog prompt below as user-provided setup context');
requireText('openrouter', 'context.prompt');

requireText('header', "{ href: '/skills', label: 'Skills' }");
requireText('footer', '<a href="/skills">Skills</a>');
for (const text of [
  '<section class="skills-home-hook">',
  'Skills · Included from Free',
  'Give your AI agent a useful job.',
  'Explore Skills',
  'Copy any prompt. Use any agent. No lock-in.',
]) requireText('homepage', text);
for (const removed of ['The hub is open', 'Publish a reviewed release.']) rejectText('homepage', removed);

for (const selector of [
  '.skills-home-hook', '.skills-page', '.skills-hero', '.skills-search', '.skills-filters',
  '.skills-grid', '.skill-card', '.skill-window', '.skill-window__setup',
]) requireText('styles', selector);
requireText('styles', 'grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr))');
requireText('styles', '@media (prefers-reduced-motion: reduce)');
for (const peach of ['#fff0e7', '#ffe2d3', '#ffc6ad', '#fb9873', '#dc6648']) requireText('styles', peach);

requireText('routes', '"/skills"');
requireText('routes', '"/api/skills"');
requireText('sitemap', 'https://superii.site/skills');
requireText('docs', 'id="skills"');
requireText('docs', 'No second skills database is maintained.');
requireText('machineDocs', '## Skills library');
requireText('compactDocs', '[Skills](https://superii.site/skills)');
requireText('compactDocs', '[Skills catalog API](https://superii.site/api/skills)');
requireText('openapi', "'/api/skills'");
requireText('openapi', "operationId: 'listAgentSkills'");
requireText('openapi', "Skill: {");
requireText('privacy', 'complete public prompt are also used as setup context');
requireText('privacy', 'complete public prompt pass with that setup conversation as context');

const prompt = '  Keep this complete prompt exactly as written.  ';
const valid = parseSkillsCatalog({
  version: 1,
  agents: [{
    slug: 'test-skill',
    name: 'Test Skill',
    category: 'Ops',
    integrations: ['Codex'],
    prompt,
    contributor: { ignored: true },
    sourceUrl: 'https://example.com/ignored',
  }],
});
if (!valid || valid.skills[0]?.prompt !== prompt) errors.push('catalog parser must preserve the complete prompt exactly');
if (valid && Object.keys(valid.skills[0]).sort().join(',') !== 'category,integrations,name,prompt,slug') {
  errors.push('normalized API skill must expose exactly category, integrations, name, prompt, and slug');
}
if (parseSkillsCatalog({ version: 1, agents: [
  { slug: 'same', name: 'One', category: 'Ops', integrations: [], prompt: 'One' },
  { slug: 'same', name: 'Two', category: 'Ops', integrations: [], prompt: 'Two' },
] })) errors.push('catalog parser must reject duplicate slugs');
if (parseSkillsCatalog({ version: 1, agents: [{ slug: '../bad', name: 'Bad', category: 'Ops', integrations: [], prompt: 'Bad' }] })) {
  errors.push('catalog parser must reject invalid slugs');
}
const setup = parseAssistantSkillContext({ name: 'Test Skill', category: 'Ops', integrations: ['Codex'], prompt });
if (!setup || setup.prompt !== prompt) errors.push('assistant setup parser must preserve the complete Skill prompt');
if (parseAssistantSkillContext({ name: 'Test Skill', category: 'Ops', integrations: [], prompt: 'Test', extra: true })) {
  errors.push('assistant setup parser must reject unknown context fields');
}
if (parseAssistantSkillContext({ name: 'Test Skill', category: 'Ops', integrations: [], prompt: 'x'.repeat(8_001) })) {
  errors.push('assistant setup parser must reject an oversized prompt');
}
if (SKILLS_SOURCE_URL !== 'https://smavgs.github.io/make-great-agents/api/agents.json') {
  errors.push('canonical generated catalog URL drifted');
}

if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

console.log('OK: Skills uses the canonical validated catalog, a five-minute resilient same-origin cache, a dense peach library, in-place detail windows, portable prompt copy, and a full-context Super ii setup handoff.');
