#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const site = JSON.parse(await readFile(resolve(root, 'src/content/site.json'), 'utf8'));

function candidates(route) {
  if (route === '/') return ['src/pages/index.astro'];
  if (route.startsWith('/a2a/v1/')) return ['src/pages/a2a/v1/[...operation].ts'];
  const clean = route.replace(/^\//, '');
  if (clean.startsWith('api/')) return [`src/pages/${clean}.ts`, `src/pages/${clean}/index.ts`];
  return [`src/pages/${clean}.astro`, `src/pages/${clean}.ts`, `src/pages/${clean}/index.astro`, `src/pages/${clean}/index.ts`];
}

const errors = [];
for (const route of site.routes) {
  let exists = false;
  for (const candidate of candidates(route)) {
    try {
      if ((await stat(resolve(root, candidate))).isFile()) exists = true;
    } catch {}
  }
  if (!exists) errors.push(`No page source for ${route}`);
}

const hrefPattern = /href=["'](\/[a-zA-Z0-9_?&=#./-]*)["']/g;
const sourceFiles = [];
async function collect(directory) {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.astro')) sourceFiles.push(path);
  }
}
await collect(resolve(root, 'src'));

const known = new Set([...site.routes, '/api/contact']);
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(hrefPattern)) {
    const path = match[1].split(/[?#]/)[0] || '/';
    let publicAsset = false;
    try {
      publicAsset = (await stat(resolve(root, 'public', path.replace(/^\//, '')))).isFile();
    } catch {}
    if (!known.has(path) && !publicAsset) {
      errors.push(`Unknown internal link ${match[1]} in ${file.replace(`${root}/`, '')}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`OK: ${site.routes.length} canonical routes and internal links verified`);
