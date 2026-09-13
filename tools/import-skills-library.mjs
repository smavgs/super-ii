#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? resolve(import.meta.dirname, '../src/content/skills-additions.json');

if (!inputPath) {
  console.error('Usage: node tools/import-skills-library.mjs <prompts.json> [output.json]');
  process.exit(1);
}

const cleanText = (value, label, maxLength) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength
    || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${label} must be clean text no longer than ${maxLength} characters`);
  }
  return value;
};

const cleanList = (value, label, maxItems, maxLength) => {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must contain at most ${maxItems} entries`);
  }
  return value.map((item, index) => cleanText(item, `${label}[${index}]`, maxLength).trim());
};

const slugify = (title, stableKey) => {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
  const suffix = createHash('sha256').update(stableKey).digest('hex').slice(0, 8);
  return `${base.slice(0, 70).replace(/-+$/g, '')}-${suffix}`;
};

const source = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
if (!Array.isArray(source) || source.length < 1 || source.length > 500) {
  throw new Error('The imported skills source must contain between 1 and 500 entries');
}

const seenSlugs = new Set();
const skills = source.map((entry, index) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Entry ${index + 1} must be an object`);
  }

  const name = cleanText(entry.title, `Entry ${index + 1} title`, 120).trim();
  const category = cleanText(entry.category, `${name} category`, 80).trim();
  const prompt = cleanText(entry.content, `${name} prompt`, 40_000);
  const stableKey = cleanText(entry.file, `${name} file`, 240).trim();
  const slug = slugify(name, stableKey);
  if (seenSlugs.has(slug)) throw new Error(`Duplicate generated slug: ${slug}`);
  seenSlugs.add(slug);

  const tags = cleanList(entry.tags ?? [], `${name} tags`, 20, 80);
  const bestWith = cleanList(entry.bestWith ?? [], `${name} bestWith`, 12, 80);
  if (!Array.isArray(entry.variables) || entry.variables.length > 20) {
    throw new Error(`${name} variables must contain at most 20 entries`);
  }
  const variables = entry.variables.map((variable, variableIndex) => {
    if (!variable || typeof variable !== 'object' || Array.isArray(variable)) {
      throw new Error(`${name} variable ${variableIndex + 1} must be an object`);
    }
    const variableName = cleanText(variable.name, `${name} variable name`, 64).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) {
      throw new Error(`${name} has an invalid variable name: ${variableName}`);
    }
    const defaultValue = typeof variable.default === 'string'
      ? variable.default
      : '';
    if (defaultValue.length > 600
      || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(defaultValue)) {
      throw new Error(`${name} variable ${variableName} has an invalid default`);
    }
    return { name: variableName, default: defaultValue };
  });

  return {
    slug,
    name,
    category,
    integrations: [],
    prompt,
    ...(tags.length ? { tags } : {}),
    ...(variables.length ? { variables } : {}),
    ...(bestWith.length ? { bestWith } : {}),
  };
});

await writeFile(outputPath, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`, 'utf8');
console.log(`Imported ${skills.length} skills into ${outputPath}`);
