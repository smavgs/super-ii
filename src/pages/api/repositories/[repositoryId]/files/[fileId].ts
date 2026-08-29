import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';

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
