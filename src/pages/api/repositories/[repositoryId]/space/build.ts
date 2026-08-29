import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { runtimeFetch } from '@/lib/runtime';
import { publishedRevisionId, runtimeJsonResponse } from '@/lib/runtime-repository';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  if (!await ensureAuthenticatedProfile(locals, sql)) return Response.json({ error: 'authentication required' }, { status: 401 });
  const repositoryId = params.repositoryId ?? '';
  const revisionId = await publishedRevisionId(sql, repositoryId, 'space');
  if (!revisionId) return Response.json({ error: 'Space not found' }, { status: 404 });
  const response = await runtimeFetch(locals, `/v1/repositories/${repositoryId}/revisions/${revisionId}/space/build`, { method: 'POST' });
  return response ? runtimeJsonResponse(response) : Response.json({ error: 'Space runtime unavailable' }, { status: 503 });
};
