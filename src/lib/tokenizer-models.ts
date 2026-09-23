import { searchCatalog } from './catalog';

export type TokenizerModelOption = {
  repository_id: string;
  owner_handle: string;
  slug: string;
  title: string;
  summary: string;
  revision_id: string;
  commit_sha: string | null;
  updated_at: string;
};

export function parseTokenizerModelReference(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 500) return null;
  let candidate = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const match = url.pathname.match(/^\/models\/([^/]+)\/([^/]+)\/?$/);
      if (!match) return null;
      candidate = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
    }
  } catch {
    return null;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(candidate)
    ? candidate
    : null;
}

export async function searchTokenizerModels(
  locals: App.Locals,
  query: string,
  limit = 8,
): Promise<{ state: 'ok' | 'unconfigured' | 'error'; items: TokenizerModelOption[] }> {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 10) : 8;
  const parsedReference = parseTokenizerModelReference(query);
  const searchQuery = parsedReference ?? query.trim().slice(0, 300);
  const catalog = await searchCatalog(
    locals,
    'model',
    { query: searchQuery || undefined, sort: searchQuery ? 'relevance' : 'updated' },
    50,
    0,
  );
  const options = catalog.items
    .filter((model) => model.tokenizer_available)
    .filter((model) => !parsedReference || `${model.owner_handle}/${model.slug}` === parsedReference)
    .slice(0, boundedLimit)
    .map((model) => ({
      repository_id: model.repository_id,
      owner_handle: model.owner_handle,
      slug: model.slug,
      title: model.title,
      summary: model.summary,
      revision_id: model.revision_id,
      commit_sha: model.commit_sha,
      updated_at: model.updated_at,
    }));
  return { state: catalog.state, items: options };
}
