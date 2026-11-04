#!/usr/bin/env node
// Import the operator-supplied data/use-cases.json. Never execute prompt content.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node tools/import-agent-use-cases.mjs <data/use-cases.json>');
const raw = await readFile(inputPath, 'utf8');
const records = JSON.parse(raw);
if (!Array.isArray(records) || !records.length) throw new Error('Expected a nonempty use-case collection');
const slugs = new Set();
const prompts = new Set();
const skills = records.map((record) => {
  const { slug: sourceSlug, title, category, prompt, summary, url } = record;
  const slug = String(sourceSlug).replace(/^-+|-+$/g, '');
  if (record.status !== 'ok' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80
    || typeof title !== 'string' || !title.trim() || title.length > 120
    || typeof category !== 'string' || !category.trim() || category.length > 80
    || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 40_000
    || typeof summary !== 'string' || summary.length > 500
    || new URL(url).origin !== 'https://agentusecases.ai'
    || slugs.has(slug) || prompts.has(prompt)) throw new Error(`Invalid or duplicate use case: ${slug}`);
  slugs.add(slug); prompts.add(prompt);
  return { slug, name: title, category, integrations: [], prompt, summary,
    source: { label: 'Agent Use Cases', url } };
});
const outputPath = resolve(import.meta.dirname, '../src/content/skills-use-cases.json');
await writeFile(outputPath, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`);
console.log(JSON.stringify({ count: skills.length, categories: new Set(skills.map(s => s.category)).size,
  sourceSha256: createHash('sha256').update(raw).digest('hex') }));
