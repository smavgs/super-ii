import MarkdownIt from 'markdown-it';
import { readCard } from './creator-card';

export type CardFile = { path: string; url: string; mime_type?: string };
export type CardContext = { files?: CardFile[]; sourceUrl?: string };
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
function externalImage(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

function repositoryPath(raw: string, sourceUrl?: string): string | null {
  try {
    const url = new URL(raw, 'https://repository.invalid/');
    if (url.origin === 'https://repository.invalid') return decodeURIComponent(url.pathname.slice(1));
    if (!sourceUrl || url.protocol !== 'https:') return null;
    const source = new URL(sourceUrl);
    const prefix = source.pathname.replace(/\/$/, '') + '/';
    if (url.origin !== source.origin || !url.pathname.startsWith(prefix)) return null;
    const suffix = url.pathname.slice(prefix.length);
    const match = suffix.match(/^(?:resolve|blob)\/[^/]+\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

export function renderRepositoryMarkdown(source: string, context: CardContext = {}) {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const escape = markdown.utils.escapeHtml;
  const files = new Map((context.files ?? []).map((file) => [file.path, file]));
  const resolve = (raw: string) => files.get(repositoryPath(raw, context.sourceUrl) ?? '');
  markdown.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const raw = String(token.attrGet('src') ?? '');
    const alt = token.content || 'Image';
    const file = resolve(raw);
    if (file && imageTypes.has(file.mime_type ?? '') && (/^\/api\/repositories\//.test(file.url) || file.url.startsWith('blob:'))) {
      return `<img src="${escape(file.url)}" alt="${escape(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
    }
    // No automatic requests to an author's third-party tracking endpoints.
    if (externalImage(raw)) {
      return `<a href="${escape(raw)}" target="_blank" rel="nofollow noreferrer" referrerpolicy="no-referrer">${escape(alt)} (external image)</a>`;
    }
    return `<span class="card-image-unavailable">${escape(alt)} (image unavailable)</span>`;
  };
  markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
    const token = tokens[index];
    const file = resolve(String(token.attrGet('href') ?? ''));
    if (file && /^\/api\/repositories\//.test(file.url)) token.attrSet('href', file.url);
    token.attrSet('rel', 'nofollow noreferrer');
    token.attrSet('target', '_blank');
    token.attrSet('referrerpolicy', 'no-referrer');
    return renderer.renderToken(tokens, index, options);
  };
  return markdown.render(readCard(source.slice(0, 100_000)).body);
}
