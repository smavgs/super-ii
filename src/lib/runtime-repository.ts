import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { RepositoryKind } from './catalog';

export async function publishedRevisionId(
  sql: NeonQueryFunction<false, false>,
  repositoryId: string,
  kind: RepositoryKind,
): Promise<string | null> {
  try {
    const rows = await sql`
      select rr.id
      from app.repositories r
      join app.repository_revisions rr on rr.id = r.latest_revision_id
      where r.id = ${repositoryId}::uuid
        and r.kind = ${kind}::repository_kind
        and r.visibility = 'public'
        and r.status = 'published'
        and rr.status = 'published'
      limit 1
    `;
    return rows[0]?.id ? String(rows[0].id) : null;
  } catch {
    return null;
  }
}

export async function runtimeJsonResponse(upstream: Response): Promise<Response> {
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
