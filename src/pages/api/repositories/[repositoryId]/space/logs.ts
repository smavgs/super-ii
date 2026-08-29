import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { runtimeFetch } from '@/lib/runtime';
import { publishedRevisionId, runtimeJsonResponse } from '@/lib/runtime-repository';

export const GET: APIRoute = async ({ locals, params, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  if (!await ensureAuthenticatedProfile(locals, sql)) return Response.json({ error: 'authentication required' }, { status: 401 });
  const repositoryId = params.repositoryId ?? '';
  const revisionId = await publishedRevisionId(sql, repositoryId, 'space');
  if (!revisionId) return Response.json({ error: 'Space not found' }, { status: 404 });
  const tail = Math.min(Math.max(Number(url.searchParams.get('tail') ?? 200) || 200, 1), 500);
  const response = await runtimeFetch(locals, `/v1/repositories/${repositoryId}/revisions/${revisionId}/space/logs?tail=${tail}`);
  return response ? runtimeJsonResponse(response) : Response.json({ error: 'Space runtime unavailable' }, { status: 503 });
};
