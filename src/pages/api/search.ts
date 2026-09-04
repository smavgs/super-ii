import type { APIRoute } from 'astro';
import { searchCatalog } from '@/lib/catalog';
import { parseCatalogRestSearchParams } from '@/lib/catalog-search';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const GET: APIRoute = async ({ locals, request, url }) => {
  const parsed = parseCatalogRestSearchParams(url.searchParams);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid search query', issues: parsed.issues },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    );
  }

  const sql = sqlClient(locals);
  if (sql) {
    const rate = await consumeRateLimit(locals, request, sql, 'catalog.search', 300, 3600);
    if (rate !== 'allowed') {
      return Response.json(
        { error: rate === 'limited' ? 'public search rate limit reached' : 'search safety service unavailable' },
        {
          status: rate === 'limited' ? 429 : 503,
          headers: {
            'cache-control': 'no-store',
            ...(rate === 'limited' ? { 'retry-after': '3600' } : {}),
          },
        },
      );
    }
  }

  const result = await searchCatalog(
    locals,
    parsed.data.kind,
    parsed.data.filters,
    parsed.data.limit,
    parsed.data.offset,
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
