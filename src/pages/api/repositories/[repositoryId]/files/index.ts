import type { APIRoute } from 'astro';
import { managedRepository, safeRepositoryPath, scopedManagedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch, runtimeIsConfigured } from '@/lib/runtime';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

const MAX_EDGE_UPLOAD = 95 * 1024 * 1024;

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:upload');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  if (authorization.actor.kind === 'agent-token') {
    return Response.json({ error: 'agent tokens must use the receipt-backed resumable transfer path' }, { status: 403 });
  }
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, repositoryId, branchId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  if (!['draft', 'quarantined'].includes(repository.revision_status)) {
    return Response.json({ error: 'this revision is not accepting uploads' }, { status: 409 });
  }
  if (!runtimeIsConfigured(locals)) {
    return Response.json({ error: 'secure upload scanning is not connected yet' }, { status: 503 });
  }
  const rateLimit = await consumeRateLimit(locals, request, sql, 'repository.upload', 200, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'upload rate limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503 },
    );
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return Response.json({ error: 'invalid multipart upload' }, { status: 400 });
  }
  const upload = incoming.get('file');
  const path = safeRepositoryPath(incoming.get('path'));
  if (!(upload instanceof File) || !path) {
    return Response.json({ error: 'a file and safe repository path are required' }, { status: 422 });
  }
  if (upload.size < 1 || upload.size > MAX_EDGE_UPLOAD) {
    return Response.json({
      error: upload.size > MAX_EDGE_UPLOAD
        ? 'this file exceeds the legacy 95 MiB upload route; use the resumable transfer uploader'
        : 'empty files are not accepted',
    }, { status: 413 });
  }

  const body = new FormData();
  body.set('path', path);
  body.set('created_by', authorization.actor.createdBy);
  body.set('upload', upload, upload.name);
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(
      locals,
      `/v1/repositories/${repository.id}/revisions/${repository.revision_id}/files`,
      { method: 'POST', body, signal: AbortSignal.timeout(120_000) },
    );
  } catch {
    return Response.json({ error: 'secure scanning runtime is unavailable' }, { status: 503 });
  }
  if (!upstream) return Response.json({ error: 'secure scanning runtime is unavailable' }, { status: 503 });
  const payload = await upstream.json().catch(() => ({ detail: 'upload failed' })) as Record<string, unknown>;
  if (!upstream.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : 'upload failed a security or format gate';
    return Response.json({ error: detail, detail: payload.detail }, { status: upstream.status });
  }
  return Response.json({ ok: true, file: payload }, { status: 201 });
};
