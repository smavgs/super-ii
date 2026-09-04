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
  hardware?: 'apple-silicon' | 'nvidia' | 'amd' | 'cpu' | 'browser' | 'llama-cpp';
  operatingSystem?: 'macos' | 'linux' | 'windows' | 'browser';
  maxRamBytes?: number;
  maxVramBytes?: number;
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
  architecture: string | null;
  quantization: string | null;
  tensor_format: string | null;
  minimum_ram_bytes: string | null;
  minimum_vram_bytes: string | null;
  compatibility_confidence: string | null;
  cpu_compatible: boolean | null;
  cuda_compatible: boolean | null;
  rocm_compatible: boolean | null;
  metal_compatible: boolean | null;
  mlx_compatible: boolean | null;
  llama_cpp_compatible: boolean | null;
  browser_compatible: boolean | null;
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

  const pageSize = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const pageOffset = Number.isSafeInteger(offset) ? Math.min(Math.max(offset, 0), 100) : 0;

  const maxSize = filters.maxSizeBytes;
  const updatedAfter = filters.updatedAfter && !Number.isNaN(Date.parse(filters.updatedAfter))
    ? new Date(filters.updatedAfter).toISOString()
    : null;
  const hardware = ['apple-silicon', 'nvidia', 'amd', 'cpu', 'browser', 'llama-cpp'].includes(filters.hardware ?? '')
    ? filters.hardware!
    : null;
  const operatingSystem = ['macos', 'linux', 'windows', 'browser'].includes(filters.operatingSystem ?? '')
    ? filters.operatingSystem!
    : null;
  const maxRamBytes = Number.isSafeInteger(filters.maxRamBytes) && (filters.maxRamBytes ?? -1) >= 0
    ? filters.maxRamBytes!
    : null;
  const maxVramBytes = Number.isSafeInteger(filters.maxVramBytes) && (filters.maxVramBytes ?? -1) >= 0
    ? filters.maxVramBytes!
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
             coalesce(metrics.trend_score, 0)::integer as trend_score,
             compatibility.architecture,
             compatibility.quantization,
             compatibility.tensor_format,
             compatibility.minimum_ram_bytes,
             compatibility.minimum_vram_bytes,
             compatibility.confidence as compatibility_confidence,
             compatibility.cpu_compatible,
             compatibility.cuda_compatible,
             compatibility.rocm_compatible,
             compatibility.metal_compatible,
             compatibility.mlx_compatible,
             compatibility.llama_cpp_compatible,
             compatibility.browser_compatible
      from matches
      join app.repositories repository on repository.id = matches.repository_id
      left join app.repository_compatibility compatibility
        on compatibility.revision_id = repository.latest_revision_id
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
      where (
        ${hardware}::text is null
        or (${hardware} = 'apple-silicon' and (compatibility.metal_compatible or compatibility.mlx_compatible))
        or (${hardware} = 'nvidia' and compatibility.cuda_compatible)
        or (${hardware} = 'amd' and compatibility.rocm_compatible)
        or (${hardware} = 'cpu' and compatibility.cpu_compatible)
        or (${hardware} = 'browser' and compatibility.browser_compatible)
        or (${hardware} = 'llama-cpp' and compatibility.llama_cpp_compatible)
      )
      and (
        ${operatingSystem}::text is null
        or (${operatingSystem} = 'macos' and (compatibility.metal_compatible or compatibility.mlx_compatible or compatibility.cpu_compatible))
        or (${operatingSystem} = 'linux' and (compatibility.cpu_compatible or compatibility.cuda_compatible or compatibility.rocm_compatible))
        or (${operatingSystem} = 'windows' and (compatibility.cpu_compatible or compatibility.cuda_compatible))
        or (${operatingSystem} = 'browser' and compatibility.browser_compatible)
      )
      and (${maxRamBytes}::bigint is null or compatibility.minimum_ram_bytes <= ${maxRamBytes})
      and (${maxVramBytes}::bigint is null or compatibility.minimum_vram_bytes <= ${maxVramBytes})
      order by
        case when ${sort} = 'trending' then coalesce(metrics.trend_score, 0) end desc,
        case when ${sort} = 'downloads' then coalesce(metrics.downloads_count, 0) end desc,
        case when ${sort} = 'likes' then coalesce(metrics.likes_count, 0) end desc,
        case when ${sort} = 'updated' then matches.updated_at end desc,
        case when ${sort} = 'relevance' then matches.rank end desc,
        matches.updated_at desc,
        matches.repository_id
      limit ${pageSize}
      offset ${pageOffset}
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
