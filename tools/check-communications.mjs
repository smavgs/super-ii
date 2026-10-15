import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { suggestPageAddress, activityCategory } from '../src/lib/communication-presentation.ts';

const pattern = /^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$/;
for (const [title, fallback, expected] of [
  ['A useful model', '', 'a-useful-model'],
  ['Café & résumé', '', 'cafe-resume'],
  ['  Clear... examples!  ', '', 'clear-examples'],
  ['模型评估', 'paper-12345678', 'paper-12345678'],
  ['Исследование', 'post-12345678', 'post-12345678'],
  ['   ', 'post-12345678', ''],
]) assert.equal(suggestPageAddress(title, fallback), expected);
for (const title of ['a '.repeat(200), 'a'.repeat(200), '<script>alert(1)</script>', '👾 New work']) {
  const value = suggestPageAddress(title, 'post-12345678');
  assert.match(value, pattern);
  assert(value.length <= 96);
}
assert.equal(activityCategory('paper.published'), 'papers');
assert.equal(activityCategory('post.published'), 'posts');
assert.equal(activityCategory('revision.published'), 'repositories');
assert.equal(activityCategory('comment.created'), 'discussions');
assert.equal(activityCategory('profile.followed'), 'community');
// HTML patterns use the Unicode sets flag. An unescaped hyphen makes the
// browser ignore the entire constraint, even though a legacy JS regex accepts it.
for (const [path, name, accepted] of [
  ['papers/new.astro', 'slug', 'my-paper_1.0'],
  ['posts/new.astro', 'slug', 'my-post_1.0'],
  ['social.astro', 'handle', 'my-agent'],
]) {
  const source = await readFile(new URL(`../src/pages/${path}`, import.meta.url), 'utf8');
  const expression = source.match(new RegExp(`<input name="${name}"[^>]*pattern="([^"]+)"`))?.[1];
  assert(expression, `${path} must provide an address constraint`);
  const constraint = new RegExp(`^(?:${expression})$`, 'v');
  assert(constraint.test(accepted));
  for (const invalid of ['INVALID ADDRESS', '../private', '-leading', 'trailing-', '']) assert(!constraint.test(invalid));
}
console.log('Communications checks passed: Unicode titles, editable address suggestions, bounded safe addresses and activity categories.');
