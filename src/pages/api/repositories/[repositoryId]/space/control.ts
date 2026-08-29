import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';
import { publishedRevisionId } from '@/lib/runtime-repository';

async function resolve(locals: App.Locals, repositoryId: string) {
  const sql = sqlClient(locals);
  if (!sql) return { ok: false as const, error: Response.json({ error: 'database unavailable' }, { status: 503 }) };
  const revisionId = await publishedRevisionId(sql, repositoryId, 'space');
  if (!revisionId) return { ok: false as const, error: Response.json({ error: 'Space not found' }, { status: 404 }) };
  return { ok: true as const, sql, revisionId };
}

export const GET: APIRoute = async ({ locals, params }) => {
  const repositoryId = params.repositoryId ?? '';
  const resolved = await resolve(locals, repositoryId);
  if (!resolved.ok) return resolved.error;
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${resolved.revisionId}/space/status`,
  );
  if (!upstream) return Response.json({ error: 'Space runtime unavailable' }, { status: 503 });
  const body = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok || !body) {
    return Response.json({ error: 'Space status unavailable' }, { status: upstream.status });
  }
  const status = typeof body.status === 'string' ? body.status : 'unavailable';
  return Response.json(
    {
      status,
      app_url: status === 'running' ? `/api/repositories/${encodeURIComponent(repositoryId)}/space/` : null,
    },
    { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } },
  );
};

async function mutate(
  locals: App.Locals,
  request: Request,
  repositoryId: string,
  action: 'start' | 'stop',
): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const resolved = await resolve(locals, repositoryId);
  if (!resolved.ok) return resolved.error;
  try {
    if (!await ensureAuthenticatedProfile(locals, resolved.sql)) {
      return Response.json({ error: 'sign in to control this Space' }, { status: 401 });
    }
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  const rateLimit = await consumeRateLimit(locals, request, resolved.sql, `space_${action}`, action === 'start' ? 5 : 20, 3600);
  if (rateLimit === 'limited') {
    return Response.json({ error: 'Space control rate limit reached' }, { status: 429, headers: { 'retry-after': '3600' } });
  }
  if (rateLimit === 'unavailable') {
    return Response.json({ error: 'Space safety service unavailable' }, { status: 503 });
  }
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${resolved.revisionId}/space/${action}`,
    { method: 'POST' },
  );
  if (!upstream) return Response.json({ error: 'Space runtime unavailable' }, { status: 503 });
  const body = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok || !body) {
    const detail = body && (body.error ?? body.detail);
    return Response.json({ error: typeof detail === 'string' ? detail : `Space ${action} failed` }, { status: upstream.status });
  }
  return Response.json(
    {
      status: body.status,
      app_url: action === 'start' ? `/api/repositories/${repositoryId}/space/` : null,
    },
    { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } },
  );
}

export const POST: APIRoute = async ({ locals, params, request }) => mutate(locals, request, params.repositoryId ?? '', 'start');
export const DELETE: APIRoute = async ({ locals, params, request }) => mutate(locals, request, params.repositoryId ?? '', 'stop');
