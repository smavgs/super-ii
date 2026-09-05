#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const files = {
  page: read('src/pages/frontier-ai.astro'),
  homepage: read('src/pages/index.astro'),
  docs: read('src/pages/docs.astro'),
  routes: read('src/content/site.json'),
  sitemap: read('public/sitemap.xml'),
  css: read('src/styles/global.css'),
};

function assert(condition, message) {
  if (!condition) throw new Error(`Frontier AI check failed: ${message}`);
}

for (const text of [
  'Maximum-power AI.',
  '$0 to start.',
  '2.8-trillion-parameter frontier model',
  'No business AI subscription required to start.',
  'No high-end GPU needed.',
  'Use it from your own computer.',
  'Use frontier AI',
  'Your computer',
  'OpenCode',
  'NVIDIA API',
  'Kimi K3',
]) {
  assert(files.page.includes(text), `guide is missing ${JSON.stringify(text)}`);
}

for (const text of [
  'Maximum-power AI.',
  '$0 to start.',
  'Use a 2.8-trillion-parameter frontier model, from your own computer',
  'No business AI subscription required to start.',
  'No high-end GPU needed.',
  'Use it from your own computer.',
  'Use frontier AI',
]) {
  assert(files.homepage.includes(text), `homepage hook is missing ${JSON.stringify(text)}`);
}

assert((files.page.match(/data-frontier-step=/g) || []).length === 3, 'guide must contain exactly three visible setup steps');
for (const step of ['access', 'connect', 'model']) {
  assert(files.page.includes(`data-frontier-step="${step}"`), `guide is missing the ${step} step`);
  assert(files.page.includes(`data-frontier-complete="${step}"`), `guide is missing completion control for ${step}`);
}

for (const source of [
  'data-frontier-copy-source="connect">/connect',
  'data-frontier-copy-source="models">/models',
  'data-frontier-copy-source="model">moonshotai/kimi-k3',
]) {
  assert(files.page.includes(source), `guide is missing copyable value ${source}`);
}

assert(files.page.includes('https://build.nvidia.com/moonshotai/kimi-k3'), 'guide must link to the exact official NVIDIA model page');
assert(files.page.includes('https://opencode.ai/docs/providers/#nvidia'), 'guide must link to official OpenCode NVIDIA instructions');
assert(files.page.includes('Your key goes directly into OpenCode—not Super ii.'), 'guide must explain the credential boundary');
assert(files.page.includes('Super ii does not collect, proxy, or store it'), 'guide must state that Super ii does not handle the provider key');
assert(!/<input\b[^>]*(?:api|key|secret)/i.test(files.page), 'guide must never render an API-key input');
assert(files.page.includes("localStorage.setItem(FRONTIER_STORAGE_KEY"), 'progress must be saved only on the user device');
assert(files.page.includes("prefers-reduced-motion: reduce"), 'progress scrolling must respect reduced motion');
assert(/data-frontier-ready[^>]*hidden/.test(files.page), 'success claim must stay hidden until the user completes all three steps');

const frontierHook = files.homepage.indexOf('<section class="frontier-home-hook"');
const participationHook = files.homepage.indexOf('<section class="participation-home"');
const skillsHook = files.homepage.indexOf('<section class="skills-home-hook"');
assert(participationHook >= 0 && frontierHook > participationHook && skillsHook > frontierHook, 'frontier hook must sit at the bottom of the homepage before the Skills call to action');
assert(/<section class="frontier-home-hook"[\s\S]*?<\/section>\s*<section class="skills-home-hook">/.test(files.homepage), 'frontier hook must sit immediately before Skills');
assert(!files.homepage.includes('Free endpoint access is controlled by NVIDIA and subject to its current trial terms and limits.'), 'homepage must omit the NVIDIA trial disclaimer');
assert(!files.homepage.includes('· NVIDIA + OpenCode'), 'homepage must omit the provider suffix');
assert(!files.homepage.includes('frontier-home-hook__path'), 'homepage must omit the connection-path illustration');
assert(!files.homepage.includes('No 2.8T model download.'), 'homepage must omit the model-download benefit');
const frontierMarkup = files.homepage.match(/<section class="frontier-home-hook"[\s\S]*?<\/section>/)?.[0] || '';
assert((frontierMarkup.match(/<li>/g) || []).length === 3, 'homepage hook must contain exactly three outlined benefits');
assert(files.homepage.includes('href="/frontier-ai"'), 'homepage call to action must open the complete guide');

assert(files.routes.includes('"/frontier-ai"'), 'canonical route registry is missing /frontier-ai');
assert(files.sitemap.includes('https://superii.site/frontier-ai'), 'sitemap is missing /frontier-ai');
assert(files.docs.includes('id="frontier-ai"'), 'documentation is missing the Frontier AI contract');

for (const selector of [
  '.frontier-home-hook',
  '.frontier-hero',
  '.frontier-orbit',
  '.frontier-path__rail',
  '.frontier-setup',
  '.frontier-steps',
  '.frontier-command',
  '.frontier-ready',
  '.frontier-truth',
]) {
  assert(files.css.includes(selector), `global.css is missing ${selector}`);
}
assert(files.css.includes('.frontier-ready[hidden]'), 'CSS must preserve the initial hidden success state');
assert(/\.frontier-home-hook\s*\{[^}]*background:\s*#000;/.test(files.css), 'homepage hook must use a black background');
assert(/\.frontier-home-hook__inner\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(files.css), 'homepage hook must use a single-column strip layout');
assert(!files.css.includes('.frontier-home-hook__path'), 'global.css must not retain the removed homepage illustration styles');
assert(/@media \(max-width: 620px\)[\s\S]*?\.frontier-step[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/.test(files.css), 'setup steps must collapse on narrow screens');
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.frontier-orbit__ring[\s\S]*?animation:\s*none/.test(files.css), 'frontier animation must stop for reduced motion');

console.log('OK: Hook 4 places a black, illustration-free homepage strip before Skills and links it to a three-step, device-local, credential-safe NVIDIA Kimi K3 setup guide.');
