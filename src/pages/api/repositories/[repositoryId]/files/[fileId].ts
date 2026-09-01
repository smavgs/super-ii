import type { APIRoute } from 'astro';
import { managedRepository, scopedManagedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

const INLINE_MEDIA_TYPES = new Set([
  'application/pdf',
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/ogg',
  'video/webm',
]);

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const fileId = params.fileId ?? '';
  let mimeType: string;
  try {
    const rows = await sql`
      select f.id, f.mime_type
      from app.repository_files f
      join app.repository_revisions rr on rr.id = f.revision_id
      join app.repositories r on r.id = f.repository_id
      where f.id = ${fileId}::uuid
        and r.id = ${repositoryId}::uuid
        and f.storage_state = 'available'
        and f.scan_status = 'clean'
        and rr.status = 'published'
        and r.latest_revision_id = rr.id
        and r.visibility = 'public'
        and r.status = 'published'
      limit 1
    `;
    if (!rows.length) return Response.json({ error: 'file not found' }, { status: 404 });
    mimeType = String(rows[0].mime_type).toLowerCase();
  } catch {
    return Response.json({ error: 'file not found' }, { status: 404 });
  }
  const inline = new URL(request.url).searchParams.get('inline') === '1'
    && INLINE_MEDIA_TYPES.has(mimeType);
  const headers = new Headers();
  for (const name of ['range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(
      locals,
      `/v1/files/${fileId}${inline ? '?inline=true' : ''}`,
      { headers },
    );
  } catch {
    return Response.json({ error: 'download runtime unavailable' }, { status: 503 });
  }
  if (!upstream) return Response.json({ error: 'download runtime unavailable' }, { status: 503 });
  const response = proxiedFileResponse(upstream);
  if (inline) {
    response.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'self'");
    response.headers.set('x-frame-options', 'SAMEORIGIN');
  }
  return response;
};

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:upload');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  if (authorization.actor.kind === 'agent-token') {
    return Response.json({ error: 'agent tokens cannot delete repository files' }, { status: 403 });
  }
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, repositoryId, branchId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  if (!['draft', 'quarantined'].includes(repository.revision_status)) {
    return Response.json({ error: 'files cannot be changed after review begins' }, { status: 409 });
  }
  try {
    const rows = await sql`
      delete from app.repository_files
      where id = ${params.fileId ?? ''}::uuid
        and repository_id = ${repository.id}::uuid
        and revision_id = ${repository.revision_id}::uuid
      returning size_bytes
    `;
    if (!rows.length) return Response.json({ error: 'file not found' }, { status: 404 });
    await sql`
      update app.repository_revisions
      set file_count = (select count(*) from app.repository_files where revision_id = ${repository.revision_id}::uuid),
          total_size_bytes = coalesce((select sum(size_bytes) from app.repository_files where revision_id = ${repository.revision_id}::uuid), 0),
          status = case when exists (
            select 1 from app.repository_files where revision_id = ${repository.revision_id}::uuid
          ) then 'quarantined'::repository_revision_status else 'draft'::repository_revision_status end
      where id = ${repository.revision_id}::uuid
    `;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'file could not be removed' }, { status: 409 });
  }
};
