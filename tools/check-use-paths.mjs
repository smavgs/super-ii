#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [home, usePage, newPage, account, repositoryPage, styles, siteSource, sitemap, llms, docs, systemState] = await Promise.all([
  read('src/pages/index.astro'),
  read('src/pages/use.astro'),
  read('src/pages/new.astro'),
  read('src/pages/account.astro'),
  read('src/components/RepositoryPage.astro'),
  read('src/styles/global.css'),
  read('src/content/site.json'),
  read('public/sitemap.xml'),
  read('public/llms.txt'),
  read('src/pages/docs.astro'),
  read('SYSTEM-STATE.md'),
]);

const requireAll = (source, markers, label) => {
  for (const marker of markers) assert.ok(source.includes(marker), `${label} is missing ${marker}`);
};

const progressIndex = home.indexOf('<p class="eyebrow">One place to make progress</p>');
const hookIndex = home.indexOf('<section class="use-home-hook" id="use-superii">');
const workerIndex = home.indexOf('<section class="ai-worker-hook" id="ai-worker-home">');
assert.ok(0 <= progressIndex && progressIndex < hookIndex && hookIndex < workerIndex, 'homepage Use hook must sit immediately before AI Worker after the progress section');
requireAll(home, [
  'Run it. Code it. Share it.',
  'Run models locally with Ollama, LM Studio &amp; ComfyUI.',
  'Use models directly in Python.',
  'Publish your work with one public link.',
  'href="/use"',
], 'homepage Use hook');

requireAll(usePage, [
  'Use Super ii your way',
  'Start where you already work.',
  'id="run"',
  'id="code"',
  'id="share"',
  'LOCAL</strong><span>Find</span>',
  'PYTHON</strong><span>Find</span>',
  'LABS</strong><span>Upload</span>',
  'No forced signup just to look at a model or copy instructions.',
  'from transformers import AutoModel, AutoTokenizer',
  'data-copy-use',
  'navigator.clipboard.writeText',
  '/new?kind=model',
  '/new?kind=space',
  'Whatever you build, give it a home.',
], '/use page');

requireAll(newPage, ['Astro.url.searchParams.get(\'kind\')', "requestedKind === 'dataset' || requestedKind === 'space'", "selected={selectedKind === 'model'}", "selected={selectedKind === 'space'}"], 'repository type preselection');
assert.ok(account.includes('class="account-card" id="repositories"'), 'Workspace repository anchor is missing');
requireAll(repositoryPage, ['data-copy-public-link', "new URL(location.pathname, location.origin).toString()", 'Public link copied.'], 'canonical public-link copy');
requireAll(styles, ['.use-home-hook', '.use-way-hero', '.use-way-section--share', '.use-python-example', '@media (max-width: 430px)', '@media (prefers-reduced-motion: reduce)'], 'Use responsive styles');

const site = JSON.parse(siteSource);
assert.ok(site.routes.includes('/use'), '/use must be a canonical route');
assert.ok(sitemap.includes('https://superii.site/use'), '/use must be in the sitemap');
assert.ok(llms.includes('[Use Super ii](https://superii.site/use)'), '/use must be in llms.txt');
assert.ok(docs.includes('id="use-superii"'), '/use contract must be documented');
assert.ok(systemState.includes('| Run, Code, Share pathways | production |'), 'system state must expose the Use pathways release');

for (const asset of ['ollama.svg', 'lm-studio.svg', 'python.svg', 'comfyui.svg']) {
  await access(path.join(root, 'public', 'brand', 'use', asset));
}

console.log('Use pathways check passed: homepage hook, open /use page, real publishing routes, reviewed assets, canonical link copy, documentation, and responsive behavior are wired.');
