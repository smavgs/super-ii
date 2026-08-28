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

  try {
    const rows = await sql`
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
        ${Math.min(Math.max(limit, 1), 100)},
        ${Math.max(offset, 0)}
      )
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
