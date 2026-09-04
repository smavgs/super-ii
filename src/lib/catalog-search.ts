import { z } from 'zod';
import type { CatalogFilters, RepositoryKind } from './catalog';

export const repositoryKindSchema = z.enum(['model', 'dataset', 'space']);
export const catalogHardwareSchema = z.enum(['apple-silicon', 'nvidia', 'amd', 'cpu', 'browser', 'llama-cpp']);
export const catalogOperatingSystemSchema = z.enum(['macos', 'linux', 'windows', 'browser']);
export const catalogSortSchema = z.enum(['relevance', 'trending', 'downloads', 'likes', 'updated']);

const querySchema = z.string().trim().max(300);
const filterTextSchema = z.string().trim().max(120);
const byteCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const dateSchema = z.iso.date();
export const catalogLimitSchema = z.number().int().min(1).max(50);
export const catalogOffsetSchema = z.number().int().min(0).max(100);

export const catalogSearchInputShape = {
  query: querySchema.optional(),
  task: filterTextSchema.optional(),
  library: filterTextSchema.optional(),
  license: filterTextSchema.optional(),
  modality: filterTextSchema.optional(),
  author: filterTextSchema.optional(),
  max_size_bytes: byteCountSchema.optional(),
  updated_after: dateSchema.optional(),
  hardware: catalogHardwareSchema.optional(),
  operating_system: catalogOperatingSystemSchema.optional(),
  available_ram_bytes: byteCountSchema.optional(),
  available_vram_bytes: byteCountSchema.optional(),
  sort: catalogSortSchema.optional(),
  limit: catalogLimitSchema.default(20),
} as const;

export const catalogSearchInputSchema = z.object(catalogSearchInputShape).strict();
export const catalogSearchWithKindSchema = z.object({
  kind: repositoryKindSchema,
  ...catalogSearchInputShape,
}).strict();

export type CatalogSearchInput = z.infer<typeof catalogSearchInputSchema>;

const unsignedIntegerQuerySchema = z.string()
  .regex(/^(0|[1-9]\d*)$/, 'must be a whole non-negative integer')
  .transform(Number)
  .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));

const restSearchSchema = z.object({
  kind: repositoryKindSchema,
  q: querySchema.optional(),
  task: filterTextSchema.optional(),
  library: filterTextSchema.optional(),
  license: filterTextSchema.optional(),
  modality: filterTextSchema.optional(),
  author: filterTextSchema.optional(),
  max_size: unsignedIntegerQuerySchema.optional(),
  updated_after: dateSchema.optional(),
  hardware: catalogHardwareSchema.optional(),
  os: catalogOperatingSystemSchema.optional(),
  max_ram_bytes: unsignedIntegerQuerySchema.optional(),
  max_vram_bytes: unsignedIntegerQuerySchema.optional(),
  sort: catalogSortSchema.optional(),
  limit: unsignedIntegerQuerySchema.pipe(catalogLimitSchema).optional(),
  offset: unsignedIntegerQuerySchema.pipe(catalogOffsetSchema).optional(),
}).strict();

const restParameterNames = new Set(Object.keys(restSearchSchema.shape));

export type ParsedCatalogRestSearch = {
  kind: RepositoryKind;
  filters: CatalogFilters;
  limit: number;
  offset: number;
};

export type CatalogSearchIssue = {
  path: string;
  message: string;
};

export function catalogFiltersFromInput(input: CatalogSearchInput): CatalogFilters {
  return {
    query: input.query,
    task: input.task,
    library: input.library,
    license: input.license,
    modality: input.modality,
    author: input.author,
    maxSizeBytes: input.max_size_bytes,
    updatedAfter: input.updated_after,
    hardware: input.hardware,
    operatingSystem: input.operating_system,
    maxRamBytes: input.available_ram_bytes,
    maxVramBytes: input.available_vram_bytes,
    sort: input.sort,
  };
}

export function parseCatalogRestSearchParams(searchParams: URLSearchParams):
  | { success: true; data: ParsedCatalogRestSearch }
  | { success: false; issues: CatalogSearchIssue[] } {
  const issues: CatalogSearchIssue[] = [];
  const raw: Record<string, string> = {};

  for (const name of new Set(searchParams.keys())) {
    if (!restParameterNames.has(name)) {
      issues.push({ path: name, message: 'unknown search parameter' });
      continue;
    }
    const values = searchParams.getAll(name);
    if (values.length !== 1) {
      issues.push({ path: name, message: 'must appear exactly once' });
      continue;
    }
    raw[name] = values[0];
  }

  if (issues.length) return { success: false, issues };

  const parsed = restSearchSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'query',
        message: issue.message,
      })),
    };
  }

  const input: CatalogSearchInput = {
    query: parsed.data.q,
    task: parsed.data.task,
    library: parsed.data.library,
    license: parsed.data.license,
    modality: parsed.data.modality,
    author: parsed.data.author,
    max_size_bytes: parsed.data.max_size,
    updated_after: parsed.data.updated_after,
    hardware: parsed.data.hardware,
    operating_system: parsed.data.os,
    available_ram_bytes: parsed.data.max_ram_bytes,
    available_vram_bytes: parsed.data.max_vram_bytes,
    sort: parsed.data.sort,
    limit: parsed.data.limit ?? 20,
  };

  return {
    success: true,
    data: {
      kind: parsed.data.kind,
      filters: catalogFiltersFromInput(input),
      limit: input.limit,
      offset: parsed.data.offset ?? 0,
    },
  };
}
