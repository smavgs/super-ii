import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { safeRepositoryPath } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';
import { runtimeJsonResponse } from '@/lib/runtime-repository';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'expected JSON' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 4096) {
    return Response.json({ error: 'request is too large' }, { status: 413 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  if (!profile) return Response.json({ error: 'sign in to execute a reviewed notebook' }, { status: 401 });
  const limit = await consumeRateLimit(locals, request, sql, 'notebook.execute', 10, 86_400);
  if (limit !== 'allowed') {
    return Response.json(
      { error: limit === 'limited' ? 'daily notebook execution limit reached' : 'safety service unavailable' },
      { status: limit === 'limited' ? 429 : 503, headers: limit === 'limited' ? { 'retry-after': '86400' } : undefined },
    );
  }
  let input: Record<string, unknown>;
  try {
    input = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const notebookPath = safeRepositoryPath(input.notebook_path);
  if (!notebookPath?.toLowerCase().endsWith('.ipynb')) {
    return Response.json({ error: 'a safe .ipynb repository path is required' }, { status: 422 });
  }
  const repositoryId = params.repositoryId ?? '';
  let revisionId: string | null = null;
  try {
    const revisions = await sql`
      select rr.id
      from app.repositories r
      join app.repository_revisions rr on rr.id = r.latest_revision_id
      where r.id = ${repositoryId}::uuid
        and r.visibility = 'public'
        and r.status = 'published'
        and rr.status = 'published'
      limit 1
    `;
    revisionId = revisions[0]?.id ? String(revisions[0].id) : null;
  } catch {
    revisionId = null;
  }
  if (!revisionId) return Response.json({ error: 'published repository not found' }, { status: 404 });
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(
      locals,
      `/v1/repositories/${repositoryId}/revisions/${revisionId}/notebooks/execute`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.profileId, notebook_path: notebookPath }),
        signal: AbortSignal.timeout(20 * 60_000),
      },
    );
  } catch {
    upstream = null;
  }
  if (!upstream) return Response.json({ error: 'isolated notebook runtime unavailable' }, { status: 503 });
  return runtimeJsonResponse(upstream);
};
