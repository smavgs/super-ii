import type { APIRoute } from 'astro';
import { searchCatalog, type RepositoryKind } from '@/lib/catalog';

const kinds = new Set<RepositoryKind>(['model', 'dataset', 'space']);

export const GET: APIRoute = async ({ locals, url }) => {
  const rawKind = url.searchParams.get('kind');
  if (!rawKind || !kinds.has(rawKind as RepositoryKind)) {
    return Response.json({ error: 'kind must be model, dataset, or space' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 24) || 24, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  const result = await searchCatalog(
    locals,
    rawKind as RepositoryKind,
    {
      query: url.searchParams.get('q') ?? undefined,
      task: url.searchParams.get('task') ?? undefined,
      library: url.searchParams.get('library') ?? undefined,
      license: url.searchParams.get('license') ?? undefined,
      modality: url.searchParams.get('modality') ?? undefined,
      author: url.searchParams.get('author') ?? undefined,
      maxSizeBytes: url.searchParams.has('max_size') ? Number(url.searchParams.get('max_size')) : undefined,
      updatedAfter: url.searchParams.get('updated_after') ?? undefined,
    },
    limit,
    offset,
  );
  const status = result.state === 'error' ? 503 : 200;
  return Response.json(result, {
    status,
    headers: {
      'cache-control': 'public, max-age=30, stale-while-revalidate=120',
      'x-content-type-options': 'nosniff',
    },
  });
};
