import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const fileId = params.fileId ?? '';
  try {
    const rows = await sql`
      select f.id
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
  } catch {
    return Response.json({ error: 'file not found' }, { status: 404 });
  }

  const headers = new Headers();
  for (const name of ['range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await runtimeFetch(locals, `/v1/files/${fileId}`, { headers });
  if (!upstream) return Response.json({ error: 'download runtime unavailable' }, { status: 503 });
  return proxiedFileResponse(upstream);
};
