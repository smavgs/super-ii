import type { NeonQueryFunction } from '@neondatabase/serverless';
import { sqlClient } from './db';

export type RepositoryKind = 'model' | 'dataset' | 'space';

export type CatalogFilters = {
  query?: string;
  task?: string;
  library?: string;
  license?: string;
  modality?: string;
  author?: string;
  maxSizeBytes?: number;
  updatedAfter?: string;
  sort?: 'relevance' | 'trending' | 'downloads' | 'likes' | 'updated';
};

export type PublicRepository = {
  repository_id: string;
  kind: RepositoryKind;
  owner_handle: string;
  slug: string;
  title: string;
  summary: string;
  license: string | null;
  task: string | null;
  library: string | null;
  modality: string | null;
  total_size_bytes: string;
  updated_at: string;
  rank: number;
  downloads_count: number;
  likes_count: number;
  trend_score: number;
};

export type CatalogResult = {
  state: 'ok' | 'unconfigured' | 'error';
  items: PublicRepository[];
};

function clean(value: string | undefined, max = 120): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

export async function searchCatalog(
  locals: App.Locals,
  kind: RepositoryKind,
  filters: CatalogFilters,
  limit = 24,
  offset = 0,
): Promise<CatalogResult> {
  const sql = sqlClient(locals);
  if (!sql) return { state: 'unconfigured', items: [] };

  const maxSize = filters.maxSizeBytes;
  const updatedAfter = filters.updatedAfter && !Number.isNaN(Date.parse(filters.updatedAfter))
    ? new Date(filters.updatedAfter).toISOString()
    : null;
  const sort = ['relevance', 'trending', 'downloads', 'likes', 'updated'].includes(filters.sort ?? '')
    ? filters.sort!
    : filters.query ? 'relevance' : 'trending';

  try {
    const rows = await sql`
      with matches as (
        select * from app.search_public_repositories(
          ${clean(filters.query, 300)},
          ${kind}::repository_kind,
          ${clean(filters.task)},
          ${clean(filters.library)},
          ${clean(filters.license)},
          ${clean(filters.modality)},
          ${clean(filters.author)},
          ${Number.isSafeInteger(maxSize) && (maxSize ?? -1) >= 0 ? maxSize : null},
          ${updatedAfter},
          100,
          0
        )
      )
      select matches.*,
             coalesce(metrics.downloads_count, 0)::integer as downloads_count,
             coalesce(metrics.likes_count, 0)::integer as likes_count,
             coalesce(metrics.trend_score, 0)::integer as trend_score
      from matches
      left join lateral (
        select
          (select count(*) from app.repository_downloads d where d.repository_id = matches.repository_id) as downloads_count,
          (select count(*) from app.likes l where l.repository_id = matches.repository_id) as likes_count,
          (
            10 * (select count(*) from app.repository_downloads d where d.repository_id = matches.repository_id and d.created_at >= now() - interval '7 days')
            + 5 * (select count(*) from app.likes l where l.repository_id = matches.repository_id and l.created_at >= now() - interval '7 days')
            + (select count(*) from app.activity_events a where a.repository_id = matches.repository_id and a.occurred_at >= now() - interval '7 days')
          ) as trend_score
      ) metrics on true
      order by
        case when ${sort} = 'trending' then coalesce(metrics.trend_score, 0) end desc,
        case when ${sort} = 'downloads' then coalesce(metrics.downloads_count, 0) end desc,
        case when ${sort} = 'likes' then coalesce(metrics.likes_count, 0) end desc,
        case when ${sort} = 'updated' then matches.updated_at end desc,
        case when ${sort} = 'relevance' then matches.rank end desc,
        matches.updated_at desc,
        matches.repository_id
      limit ${Math.min(Math.max(limit, 1), 100)}
      offset ${Math.max(offset, 0)}
    `;
    return { state: 'ok', items: rows as PublicRepository[] };
  } catch {
    return { state: 'error', items: [] };
  }
}

export function repositoryPath(item: PublicRepository): string {
  const prefix = item.kind === 'model' ? 'models' : item.kind === 'dataset' ? 'datasets' : 'spaces';
  return `/${prefix}/${encodeURIComponent(item.owner_handle)}/${encodeURIComponent(item.slug)}`;
}

export function catalogDatabase(sql: NeonQueryFunction<false, false> | null) {
  return sql;
}
