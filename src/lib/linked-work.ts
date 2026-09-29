import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { CatalogFilters, RepositoryKind } from './catalog';
import { sqlClient } from './db';

export type LinkedWorkItem = {
  id: string;
  kind: RepositoryKind;
  provider: 'huggingface';
  provider_repo_id: string;
  provider_namespace: string;
  provider_slug: string;
  source_url: string;
  source_revision: string;
  title: string;
  summary: string;
  license: string | null;
  file_count: number;
  total_size_bytes: string;
  provider_downloads: string | null;
  provider_likes: string | null;
  source_metadata: Record<string, unknown>;
  owner_handle: string;
  owner_display_name: string;
  owner_avatar_url: string | null;
  owner_type: 'person' | 'organization';
  updated_at: string;
};

export type LinkedWorkResult = {
  state: 'ok' | 'unconfigured' | 'error';
  items: LinkedWorkItem[];
};

function clean(value: string | undefined, max = 300): string {
  return value?.trim().slice(0, max) ?? '';
}

export async function searchLinkedWork(
  locals: App.Locals,
  kind: RepositoryKind,
  filters: CatalogFilters,
  limit = 24,
  offset = 0,
): Promise<LinkedWorkResult> {
  const sql = sqlClient(locals);
  if (!sql) return { state: 'unconfigured', items: [] };
  const pageSize = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 24;
  const pageOffset = Number.isSafeInteger(offset) ? Math.min(Math.max(offset, 0), 100) : 0;
  const query = clean(filters.query);
  const task = clean(filters.task, 120);
  const library = clean(filters.library, 120);
  const license = clean(filters.license, 120);
  const modality = clean(filters.modality, 120);
  const author = clean(filters.author, 120);
  const maxSizeBytes = typeof filters.maxSizeBytes === 'number' && Number.isFinite(filters.maxSizeBytes) && filters.maxSizeBytes >= 0
    ? Math.min(Math.trunc(filters.maxSizeBytes), 21_474_836_480)
    : null;
  const updatedAfter = /^\d{4}-\d{2}-\d{2}$/u.test(filters.updatedAfter ?? '')
    ? filters.updatedAfter!
    : '';
  if (filters.hardware || filters.operatingSystem || filters.maxRamBytes !== undefined || filters.maxVramBytes !== undefined) {
    return { state: 'ok', items: [] };
  }
  const sort = ['downloads', 'likes', 'updated'].includes(filters.sort ?? '')
    ? filters.sort!
    : 'updated';
  try {
    const rows = await sql`
      select item.id, item.kind, item.provider, item.provider_repo_id,
             item.provider_namespace, item.provider_slug, item.source_url,
             item.source_revision, item.title, item.summary, item.license,
             item.file_count, item.total_size_bytes, item.provider_downloads,
             item.provider_likes, item.source_metadata,
             coalesce(profile.handle, organization.handle) as owner_handle,
             coalesce(profile.display_name, organization.full_name, organization.name) as owner_display_name,
             coalesce(profile.avatar_url, organization.logo_url) as owner_avatar_url,
             case when item.owner_profile_id is not null then 'person' else 'organization' end as owner_type,
             item.updated_at
      from app.external_catalog_items item
      left join app.profiles profile on profile.id = item.owner_profile_id and profile.is_public
      left join app.organizations organization on organization.id = item.owner_organization_id and organization.is_public
      where item.status = 'active' and item.kind = ${kind}::repository_kind
        and ((item.owner_profile_id is not null and profile.id is not null)
          or (item.owner_organization_id is not null and organization.id is not null))
        and (${query} = '' or concat_ws(' ', item.provider_repo_id, item.title, item.summary,
              item.source_metadata->>'task', item.source_metadata->>'library') ilike '%' || ${query} || '%')
        and (${task} = '' or coalesce(item.source_metadata->>'task','') ilike '%' || ${task} || '%')
        and (${library} = '' or coalesce(item.source_metadata->>'library', item.source_metadata->>'sdk','') ilike '%' || ${library} || '%')
        and (${license} = '' or coalesce(item.license,'') ilike '%' || ${license} || '%')
        and (${modality} = '' or coalesce(item.source_metadata->>'modality','') ilike '%' || ${modality} || '%')
        and (${author} = '' or item.provider_namespace ilike '%' || ${author} || '%'
              or coalesce(profile.handle, organization.handle, '') ilike '%' || ${author} || '%')
        and (${maxSizeBytes}::bigint is null or item.total_size_bytes <= ${maxSizeBytes}::bigint)
        and (${updatedAfter} = '' or item.updated_at >= nullif(${updatedAfter}, '')::date)
      order by
        case when ${sort} = 'downloads' then coalesce(item.provider_downloads, 0) end desc,
        case when ${sort} = 'likes' then coalesce(item.provider_likes, 0) end desc,
        item.updated_at desc, item.id
      limit ${pageSize} offset ${pageOffset}
    `;
    return { state: 'ok', items: rows as LinkedWorkItem[] };
  } catch {
    return { state: 'error', items: [] };
  }
}

export async function listOwnerLinkedWork(
  sql: NeonQueryFunction<false, false>,
  ownerType: 'person' | 'organization',
  ownerId: string,
  limit = 100,
): Promise<LinkedWorkItem[]> {
  const rows = await sql.query(
    `select item.id, item.kind, item.provider, item.provider_repo_id,
            item.provider_namespace, item.provider_slug, item.source_url,
            item.source_revision, item.title, item.summary, item.license,
            item.file_count, item.total_size_bytes, item.provider_downloads,
            item.provider_likes, item.source_metadata,
            coalesce(profile.handle, organization.handle) as owner_handle,
            coalesce(profile.display_name, organization.full_name, organization.name) as owner_display_name,
            coalesce(profile.avatar_url, organization.logo_url) as owner_avatar_url,
            case when item.owner_profile_id is not null then 'person' else 'organization' end as owner_type,
            item.updated_at
     from app.external_catalog_items item
     left join app.profiles profile on profile.id = item.owner_profile_id
     left join app.organizations organization on organization.id = item.owner_organization_id
     where item.status = 'active'
       and (($1 = 'person' and item.owner_profile_id = $2::uuid)
         or ($1 = 'organization' and item.owner_organization_id = $2::uuid))
     order by item.updated_at desc, item.id limit $3`,
    [ownerType, ownerId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows as LinkedWorkItem[];
}

export function linkedWorkKindPath(kind: RepositoryKind): string {
  return kind === 'model' ? '/models' : kind === 'dataset' ? '/datasets' : '/spaces';
}
