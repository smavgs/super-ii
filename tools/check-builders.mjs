#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [
  builderLibrary,
  builderPage,
  creatorLink,
  catalogLibrary,
  catalog,
  repositoryLibrary,
  repositoryPage,
  useModel,
  postList,
  postPage,
  paperList,
  paperPage,
  feed,
  collectionList,
  collectionPage,
  header,
  footer,
  siteSource,
  sitemap,
  styles,
  machineGuide,
  systemState,
] = await Promise.all([
  read('src/lib/builders.ts'),
  read('src/pages/builders.astro'),
  read('src/components/CreatorLink.astro'),
  read('src/lib/catalog.ts'),
  read('src/components/Catalog.astro'),
  read('src/lib/repository.ts'),
  read('src/components/RepositoryPage.astro'),
  read('src/components/UseModel.astro'),
  read('src/pages/posts/index.astro'),
  read('src/pages/posts/[owner]/[slug].astro'),
  read('src/pages/papers/index.astro'),
  read('src/pages/papers/[owner]/[slug].astro'),
  read('src/pages/feed.astro'),
  read('src/pages/collections/index.astro'),
  read('src/pages/collections/[owner]/[slug].astro'),
  read('src/components/Header.astro'),
  read('src/components/Footer.astro'),
  read('src/content/site.json'),
  read('public/sitemap.xml'),
  read('src/styles/global.css'),
  read('src/pages/llms-full.txt.ts'),
  read('SYSTEM-STATE.md'),
]);

const requireText = (source, marker, path) => assert.ok(source.includes(marker), `${path} is missing ${marker}`);

for (const marker of [
  "requestedQuery.trim().slice(0, 80)",
  'boundedInteger(requestedPageSize, 48, 1, 60)',
  'position(lower(${query})',
  'where profile.is_public',
  "repository.visibility = 'public' and repository.status = 'published'",
  "post.is_public",
  "proposal.status <> 'removed'",
  'last_active_at desc',
]) requireText(builderLibrary, marker, 'builders query');

assert.ok(!builderLibrary.includes('order by likes_count'), 'profile likes must not rank builders');
assert.ok(!builderLibrary.includes('order by followers_count'), 'followers must not rank builders');

for (const marker of [
  'getPublicBuilders',
  'data-builders-search',
  'press Enter to search everyone',
  '<CreatorLink',
  'View profile',
  'builders-pagination',
  'href="/sign-up"',
  'href="/account#profile"',
]) requireText(builderPage, marker, 'builders page');

for (const marker of ['/people/${encodeURIComponent(handle)}', '/organizations/${encodeURIComponent(handle)}', 'creator-link__fallback', 'referrerpolicy="no-referrer"']) {
  requireText(creatorLink, marker, 'creator link');
}

for (const marker of ['creator.handle as creator_handle', 'creator.display_name as creator_display_name', 'creator.avatar_url as creator_avatar_url', 'owner_organization.handle as owner_organization_handle']) {
  requireText(catalogLibrary, marker, 'catalog identity query');
  requireText(repositoryLibrary, marker, 'repository identity query');
}

for (const source of [catalog, repositoryPage, useModel, postList, postPage, paperList, paperPage, feed, collectionList, collectionPage]) {
  requireText(source, 'CreatorLink', 'public discovery surface');
}

for (const source of [header, footer, siteSource, sitemap, machineGuide, systemState]) {
  requireText(source, '/builders', 'public navigation and documentation');
}

for (const marker of ['.creator-link', '.builders-hero', '.builder-entry', '.builders-pagination', '@media (max-width: 430px)', '@media (prefers-reduced-motion: no-preference)']) {
  requireText(styles, marker, 'responsive builder styles');
}

assert.ok(!builderPage.includes('style='), 'Builders page must not depend on inline style attributes');
assert.ok(!catalog.trim().includes('<a class="catalog-card"'), 'catalog cards must expose independent creator and repository links');
assert.ok(!postList.trim().includes('<a class="content-card"'), 'post cards must expose independent author and post links');

console.log('Builders check passed: public directory, bounded search and pagination, creator identity links, organization fallback, responsive layout, and non-popularity ordering are wired.');
