import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { LinkedWorkItem } from './linked-work';

export type HfListing = LinkedWorkItem & {
  kind: 'model' | 'dataset' | 'space';
  last_checked_at?: string;
  card_markdown: string;
  owner_profile_id: string | null;
  owner_organization_id: string | null;
};
export type HfFile = { type: 'file' | 'directory'; path: string; size: number; oid: string; sha256?: string };
export class HfSourceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const validHfId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const validHfRepo = (repo: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(repo);
export const validHfRevision = (revision: unknown): revision is string => typeof revision === 'string' && /^[a-f0-9]{40,64}$/.test(revision);
export const validHfPath = (path: string, root = false) => (root && path === '') || (path.length <= 1024 && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\%\u0000-\u001f\u007f]/.test(part)));
export const validHfCursor = (cursor: string) => cursor === '' || /^[A-Za-z0-9+/_=-]{1,2000}$/.test(cursor);
export const hfFrameOrigin = (subdomain: unknown): string | null => typeof subdomain === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) ? `https://${subdomain}.hf.space` : null;
// Verified at the original Space on 2026-11-08: DeepSite redirects to its own
// domain and rejects its hf.space host. Keep the listing local; do not embed it.
export const hfAppExternalUrl = (item: Pick<HfListing, 'kind' | 'provider_repo_id'>): string | null =>
  item.kind === 'space' && item.provider_repo_id.toLowerCase() === 'enzostvs/deepsite' ? 'https://deepsite.hf.co/' : null;
export const hfPagePath = (item: Pick<LinkedWorkItem, 'id' | 'kind' | 'owner_handle'>) => `/${item.kind === 'model' ? 'models' : item.kind === 'dataset' ? 'datasets' : 'spaces'}/${encodeURIComponent(item.owner_handle)}/hf-${item.id}`;
export const hfDownloadPath = (id: string, path: string) => `/api/huggingface/${id}/download?path=${encodeURIComponent(path)}`;
export const encodeHfPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export function hfApiBase(item: Pick<HfListing, 'kind' | 'provider_repo_id' | 'source_revision'>) {
  if (!['model','dataset','space'].includes(item.kind) || !validHfRepo(item.provider_repo_id) || !validHfRevision(item.source_revision)) throw new HfSourceError(400, 'Invalid source.');
  return `https://huggingface.co/api/${item.kind === 'model' ? 'models' : item.kind === 'dataset' ? 'datasets' : 'spaces'}/${encodeHfPath(item.provider_repo_id)}`;
}

export async function getHfListing(sql: NeonQueryFunction<false, false>, id: string): Promise<HfListing | null> {
  if (!validHfId(id)) return null;
  const rows = await sql.query(`select item.*,coalesce(profile.handle,organization.handle) as owner_handle,
    coalesce(profile.display_name,organization.full_name,organization.name) as owner_display_name,
    coalesce(profile.avatar_url,organization.logo_url) as owner_avatar_url,
    case when item.owner_profile_id is not null then 'person' else 'organization' end as owner_type
    from app.external_catalog_items item
    left join app.profiles profile on profile.id=item.owner_profile_id and profile.is_public
    left join app.organizations organization on organization.id=item.owner_organization_id and organization.is_public
    where item.id=$1::uuid and item.provider='huggingface'
      and item.kind in ('model','dataset','space') and item.status='active'
      and (profile.id is not null or organization.id is not null) limit 1`, [id]);
  return (rows[0] as HfListing | undefined) ?? null;
}

// Bound metadata independently of Content-Length, including chunked responses.
export async function hfJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new HfSourceError([401,403].includes(response.status) ? 403 : response.status === 404 ? 404 : 502,
      [401,403].includes(response.status) ? 'This source requires access on Hugging Face.' : 'Hugging Face is temporarily unavailable.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {value,done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new HfSourceError(502,'Source metadata is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const metadataRequest = (url: string, fetcher: typeof fetch, body?: URLSearchParams) => fetcher(url, {
  method: body ? 'POST' : 'GET', body, redirect: 'manual', signal: AbortSignal.timeout(15000),
  headers: {accept:'application/json', 'user-agent':'SuperiiCatalog/1.0'},
});

export async function hfPublicState(item: HfListing, fetcher: typeof fetch = fetch) {
  const fields = ['private','disabled', ...(item.kind === 'space' ? ['runtime','subdomain'] : ['gated'])];
  const query = new URLSearchParams(); fields.forEach(field => query.append('expand',field));
  const data = await hfJson(await metadataRequest(`${hfApiBase(item)}?${query}`,fetcher)) as Record<string, unknown>;
  if (typeof data.id !== 'string' || data.id.toLowerCase() !== item.provider_repo_id.toLowerCase() || data.private !== false || data.disabled === true) throw new HfSourceError(404,'This public source is unavailable.');
  if (data.gated) throw new HfSourceError(403,'This source requires access on Hugging Face.');
  return data;
}

function parseFile(value: unknown): HfFile {
  const file = value as HfFile & { lfs?: {oid?:unknown; size?:unknown} };
  if (!file || !['file','directory'].includes(file.type) || typeof file.path !== 'string' || !validHfPath(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{40,64}$/.test(file.oid)) throw new HfSourceError(502,'Invalid source file metadata.');
  const sha256 = typeof file.lfs?.oid === 'string' && /^[a-f0-9]{64}$/.test(file.lfs.oid) ? file.lfs.oid : undefined;
  return {type:file.type,path:file.path,size:file.size,oid:file.oid,...(sha256 ? {sha256} : {})};
}
export async function hfFiles(item: HfListing, path = '', cursor = '', fetcher: typeof fetch = fetch) {
  if (!validHfPath(path,true) || !validHfCursor(cursor)) throw new HfSourceError(400,'Invalid folder.');
  await hfPublicState(item,fetcher);
  const url = new URL(`${hfApiBase(item)}/tree/${item.source_revision}${path ? '/'+encodeHfPath(path) : ''}`);
  url.search = new URLSearchParams({recursive:'false',expand:'false',limit:'30',...(cursor ? {cursor} : {})}).toString();
  const response = await metadataRequest(url.href,fetcher);
  const link = response.headers.get('link');
  const raw = await hfJson(response);
  if (!Array.isArray(raw) || raw.length > 30) throw new HfSourceError(502,'Invalid source folder.');
  const files = raw.map(parseFile);
  for (const file of files) {
    const parent = file.path.includes('/') ? file.path.slice(0,file.path.lastIndexOf('/')) : '';
    if (parent !== path) throw new HfSourceError(502,'Source folder mismatch.');
  }
  let next = '';
  const match = link?.match(/<([^>]+)>;\s*rel="next"/);
  if (match) {
    const target = new URL(match[1]);
    if (target.origin !== url.origin || target.pathname !== url.pathname || !validHfCursor(target.searchParams.get('cursor') ?? '')) throw new HfSourceError(502,'Invalid source pagination.');
    next = target.searchParams.get('cursor') ?? '';
  }
  return {files,next,path,revision:item.source_revision};
}
export async function hfFile(item: HfListing, path: string, fetcher: typeof fetch = fetch): Promise<HfFile> {
  if (!validHfPath(path)) throw new HfSourceError(400,'Invalid file.');
  await hfPublicState(item,fetcher);
  const raw = await hfJson(await metadataRequest(`${hfApiBase(item)}/paths-info/${item.source_revision}`,fetcher,new URLSearchParams({paths:path,expand:'false'})));
  if (!Array.isArray(raw) || raw.length !== 1) throw new HfSourceError(404,'This source file is unavailable.');
  const file = parseFile(raw[0]);
  if (file.type !== 'file' || file.path !== path) throw new HfSourceError(404,'This source file is unavailable.');
  return file;
}
