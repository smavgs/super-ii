import MarkdownIt from 'markdown-it';
import { stripLocalePrefix } from './i18n';
import { ollamaDownloadPath, type OllamaListing, type OllamaFile } from './ollama';
import type { ExplorerCard } from './robot-explorer-ui';

const markdown = new MarkdownIt({ html: false, linkify: false });
const escape = markdown.utils.escapeHtml;
const decode = markdown.utils.unescapeAll;
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], raw = token.attrGet('src') ?? '', label = token.content || 'Image';
  try {
    const target = new URL(String(raw), 'https://superii.site');
    if (!['https:','http:'].includes(target.protocol) || target.username || target.password) return escape(label);
    return `<a href="${escape(target.href)}" rel="noreferrer">${escape(label)} (image)</a>`;
  } catch { return escape(label); }
};
const publicRoots = new Set(['', 'models', 'datasets', 'spaces', 'agents', 'skills', 'robots', 'robot', 'products', 'organizations', 'builders', 'collections', 'use', 'build', 'tokenizer', 'notebooks', 'papers', 'posts', 'social', 'feed', 'proposals', 'fame', 'highlights', 'enterprise', 'pricing', 'docs', 'about', 'security', 'legal/privacy', 'legal/terms', 'contact', 'join-team', 'transparent', 'status', 'system-state', 'frontier-ai']);
export function publicMachinePath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname).replace(/^\/+|\/+$/g, '');
  if (publicRoots.has(path)) return true;
  if (/^(?:people|agents|organizations|social|notebooks|proposals|transparent|linked)\/[^/.]+$/.test(path)) return !path.endsWith('/new');
  return /^(?:models|datasets|spaces|papers|posts|collections|robot|products)\/[^/.]+\/[^/]+$/.test(path)
    && !path.includes('/new') && !path.endsWith('/edit');
}
export function viewUrl(url: URL, view: 'human' | 'machine' | 'markdown'): string {
  const target = new URL(url);
  target.searchParams.delete('view');
  if (view !== 'human') target.searchParams.set('view', view);
  return target.pathname + target.search;
}
const protocolLinks = [
  ['Join Super ii', '/siiwebskill.md'], ['Public MCP', '/mcp'], ['Scoped work access', '/agents/connect.md'],
  ['Machine documentation', '/llms-full.txt'], ['API contract', '/openapi.json'],
] as const;
export function machineResources(url: URL): string {
  const path = stripLocalePrefix(url.pathname);
  const links: Array<readonly [string, string]> = [...protocolLinks];
  if (path.startsWith('/robots')) {
    const query = new URLSearchParams(url.search); query.delete('view');
    const selected = query.get('product') || query.get('company');
    if (selected) { query.delete('product'); query.delete('company'); query.set('id',selected); }
    links.unshift(['Robot catalogue and product details (JSON)', '/api/robots/explore?' + query]);
  }
  if (path.startsWith('/social')) links.unshift(['Social agent protocol', '/social/agents.md']);
  if (path.startsWith('/transparent')) links.unshift(['Transparency protocol', '/transparent/agents.md']);
  if (path.startsWith('/robot')) links.push(['Robot protocol', '/robot/agents.md']);
  return '\n\n## Machine access\n\n' + links.map(([label, href]) => `- [${label}](${new URL(href, url.origin)})`).join('\n')
    + '\n\nPublic reading needs no account. Writes require a human-approved scoped credential. Switching views grants no additional access.\n';
}

// Transform the actual anonymous server-rendered main, rather than maintaining a
// second copy of page content. Two streaming passes remove non-content before
// collecting text, so scripts, form values and unopened dialogs cannot leak.
export async function pageMarkdown(response: Response, url: URL): Promise<string> {
  const clean = new HTMLRewriter().on('script, style, template, noscript, nav, form, button, dialog, [hidden], [aria-hidden="true"], [data-machine-exclude]', { element(e) { e.remove(); } }).transform(response);
  let output = '', title = '', inCode = false;
  const append = (text: string) => { output += text; };
  const rewriter = new HTMLRewriter()
    .on('title', { text(t) { title += t.text; } })
    .on('main', { text(t) { append(inCode ? t.text : t.text.replace(/\s+/g, ' ')); } })
    .on('main *', { element(e) {
      const tag = e.tagName;
      if (/^h[1-6]$/.test(tag)) { append('\n\n' + '#'.repeat(Number(tag[1])) + ' '); e.onEndTag(() => append('\n\n')); }
      else if (['p','div','section','article','header','footer','ul','ol','dl','details','summary','figure','blockquote'].includes(tag)) { append('\n\n'); e.onEndTag(() => append('\n\n')); }
      else if (tag === 'li') { append('\n- '); e.onEndTag(() => append('\n')); }
      else if (tag === 'br' || tag === 'tr') append('\n');
      else if (tag === 'td' || tag === 'th' || tag === 'dd') { append(' | '); }
      else if (tag === 'pre') { inCode = true; append('\n\n```\n'); e.onEndTag(() => { inCode = false; append('\n```\n\n'); }); }
      else if (tag === 'code' && !inCode) { append('`'); e.onEndTag(() => append('`')); }
      else if (tag === 'span' && !inCode) e.onEndTag(() => append(' '));
      else if (tag === 'a') {
        try {
          const target = new URL(decode(e.getAttribute('href') ?? ''), url);
          if (!['https:', 'http:', 'mailto:'].includes(target.protocol)) return;
          target.searchParams.delete('view');
          append('['); e.onEndTag(() => append(`](<${target.href}>)`));
        } catch { /* Ignore unusable links. */ }
      } else if (tag === 'img') {
        const alt = e.getAttribute('alt');
        if (alt) append(` ${alt} `);
      }
    } });
  await rewriter.transform(clean).arrayBuffer();
  const content = decode(output).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return `# ${decode(title).trim() || 'Super ii'}\n\nSource: ${new URL(viewUrl(url, 'human'), url.origin)}\n\n${content}${machineResources(url)}`;
}

export function machinePage(content: string, url: URL, status = 200): Response {
  const human = escape(viewUrl(url, 'human')), raw = escape(viewUrl(url, 'markdown'));
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Machine view · Super ii</title><link rel="stylesheet" href="/styles/machine.css"></head><body class="machine-page" data-no-translate><header><a class="machine-brand" href="/">👾 Super ii</a><nav aria-label="Page view"><a href="${human}">Human</a><a href="${escape(viewUrl(url,'machine'))}" aria-current="page">Machine</a></nav></header><main><div class="machine-tools"><span>PUBLIC PAGE / MACHINE VIEW</span><a href="${raw}">Raw Markdown ↗</a><button type="button" data-copy-machine>Copy page</button><button type="button" data-copy-agent>Copy agent instruction</button><span role="status" data-copy-status></span></div><article>${markdown.render(content)}</article><textarea hidden data-machine-source>${escape(content)}</textarea></main><script src="/scripts/machine.js" defer></script></body></html>`, { status, headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', vary:'Accept, Cookie' } });
}
export async function representPage(response: Response, url: URL, view: string | null, accept: string): Promise<Response> {
  if (!response.headers.get('content-type')?.includes('text/html') || response.status >= 300 && response.status < 400) return response;
  const content = await pageMarkdown(response, url);
  if (view === 'machine') return machinePage(content, url, response.status);
  return accept.includes('application/json') && view !== 'markdown'
    ? Response.json({ url: new URL(viewUrl(url, 'human'), url.origin).href, content_markdown: content }, { status: response.status, headers: { 'cache-control':'no-store', vary:'Accept, Cookie' } })
    : new Response(content, { status: response.status, headers: { 'content-type':'text/markdown; charset=utf-8', 'cache-control':'no-store', vary:'Accept, Cookie' } });
}
export function ollamaDocument(item: OllamaListing, origin: string, tag: string, files: OllamaFile[]) {
  return { kind:'model', provider:'ollama', owner:item.owner_handle, title:item.title, summary:item.summary, source_url:item.source_url, license:item.license, card_markdown:item.card_markdown, source_revision:item.source_revision, updated_at:item.updated_at, weights_stored_by_superii:false, tag, files: files.map(file => ({ ...file, download_url:new URL(ollamaDownloadPath(item.id,tag,file),origin).href })), source_metadata:item.source_metadata };
}
export function ollamaMarkdown(item: OllamaListing, url: URL, tag: string, files: OllamaFile[]): string {
  const doc = ollamaDocument(item, url.origin, tag, files);
  return `# ${item.title}\n\n${item.summary}\n\nCurated by @${item.owner_handle}. Model credits and terms belong to the original publishers.\n\nSource: ${item.source_url}\n\nLicense: ${item.license || 'See source terms'}\n\n${item.card_markdown}\n\n## Files · ${tag}\n\n${doc.files.map(file=>`- [${file.filename}](${file.download_url}) — ${file.size} bytes; ${file.digest}`).join('\n') || 'No downloadable files in this source snapshot. See the source for availability.'}\n\nSelect another version with the tag query parameter. Downloads stream upstream files with their proper filenames. Super ii stores no model weights for this listing.${machineResources(url)}`;
}
export function robotMarkdown(item: ExplorerCard, url: URL): string {
  const links = [item.details_url, item.product_url, item.company_url, item.source_url, item.website].filter((href):href is string=>Boolean(href));
  return `# ${item.name}\n\n${item.summary ?? ''}\n\nType: ${item.record_type} · Source: ${item.source}\n\n## Published details\n\n\`\`\`json\n${JSON.stringify(item,null,2)}\n\`\`\`\n\n## Resources\n\n${links.map(href=>`- ${new URL(href,url.origin).href}`).join('\n')}\n- [Structured detail](${url.origin}/api/robots/explore?id=${item.id})${machineResources(url)}`;
}
