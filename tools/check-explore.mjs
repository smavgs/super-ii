import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { optionalBytes } from '../src/lib/explore-presentation.ts';

// Empty GET fields must never become a zero-byte storage or memory constraint.
for (const value of [null, '', '  ', 'bad', '-1', 'Infinity', '1e100']) assert.equal(optionalBytes(value), undefined);
assert.equal(optionalBytes('0'), 0);
assert.equal(optionalBytes('1.25', 1024 ** 3), 1_342_177_280);
assert.equal(optionalBytes('8', 1024 ** 3), 8_589_934_592);
assert.equal(optionalBytes('1024'), 1024);
assert.equal(optionalBytes('0.1'), undefined);

// Browsers enforce HTML patterns with the v flag, unlike legacy JavaScript regexes.
const page = await readFile(new URL('../src/pages/collections/index.astro', import.meta.url), 'utf8');
const pattern = page.match(/<input name="slug"[^>]*pattern="([^"]+)"/)?.[1];
assert(pattern);
const address = new RegExp(`^(?:${pattern})$`, 'v');
for (const value of ['local-ai', 'my_collection.1', 'a']) assert(address.test(value));
for (const value of ['', '../private', '-start', 'end-', 'UPPER', 'two words']) assert(!address.test(value));
console.log('Explore checks passed: empty numeric filters, bounded byte values and browser address constraints.');
