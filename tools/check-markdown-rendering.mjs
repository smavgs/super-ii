#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@': path.join(root, 'src') } },
});

try {
  const { renderNotebookMarkdown } = await vite.ssrLoadModule('/src/lib/notebook-markdown.ts');
  const rendered = renderNotebookMarkdown(`
# Reviewed model card

| Field | Value |
| --- | --- |
| Format | MLX |

[Verified source](https://example.com/evidence)

<script>alert('unsafe html')</script>

[unsafe link](javascript:alert('unsafe link'))

![tracking pixel](https://example.com/tracker.png)
`);

  assert.match(rendered, /<h1>Reviewed model card<\/h1>/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /href="https:\/\/example\.com\/evidence"/);
  assert.match(rendered, /rel="nofollow noreferrer"/);
  assert.match(rendered, /target="_blank"/);
  assert.match(rendered, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(rendered, /<script[\s>]/i);
  assert.doesNotMatch(rendered, /href="javascript:/i);
  assert.doesNotMatch(rendered, /<img[\s>]/i);

  console.log('OK: repository Markdown renders headings and tables while blocking raw HTML, unsafe links, and remote images');
} finally {
  await vite.close();
}
