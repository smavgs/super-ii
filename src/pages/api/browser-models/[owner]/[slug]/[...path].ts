import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';

function safePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
    new TextEncoder().encode(normalized).length > 1024
  ) return null;
  return normalized;
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const owner = params.owner ?? '';
  const slug = params.slug ?? '';
  const path = safePath(params.path ?? '');
  if (!path) return Response.json({ error: 'invalid model path' }, { status: 400 });

  let fileId: string;
  try {
    const rows = await sql`
      select f.id
      from app.repositories r
      join app.repository_revisions rr on rr.id = r.latest_revision_id
      join app.repository_files f on f.revision_id = rr.id
      where r.kind = 'model'
        and lower(r.owner_handle) = lower(${owner})
        and lower(r.slug) = lower(${slug})
        and r.visibility = 'public'
        and r.status = 'published'
        and rr.status = 'published'
        and f.path = ${path}
        and f.storage_state = 'available'
        and f.scan_status = 'clean'
      limit 1
    `;
    if (!rows.length) return Response.json({ error: 'model file not found' }, { status: 404 });
    fileId = String(rows[0].id);
  } catch {
    return Response.json({ error: 'model file not found' }, { status: 404 });
  }

  const headers = new Headers();
  for (const name of ['range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await runtimeFetch(locals, `/v1/files/${fileId}`, { headers });
  if (!upstream) return Response.json({ error: 'browser model runtime unavailable' }, { status: 503 });
  return proxiedFileResponse(upstream);
};
