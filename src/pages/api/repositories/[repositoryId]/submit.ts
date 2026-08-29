import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch, runtimeIsConfigured } from '@/lib/runtime';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = await managedRepository(sql, params.repositoryId ?? '', profile.profileId, branchId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  if (!runtimeIsConfigured(locals)) {
    return Response.json({ error: 'secure review runtime is not connected yet' }, { status: 503 });
  }
  const rateLimit = await consumeRateLimit(locals, request, sql, 'repository.submit', 20, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json({ error: rateLimit === 'limited' ? 'submission limit reached' : 'safety service unavailable' }, { status: rateLimit === 'limited' ? 429 : 503 });
  }

  let inspection: Response | null;
  try {
    inspection = await runtimeFetch(
      locals,
      `/v1/repositories/${repository.id}/revisions/${repository.revision_id}/inspect`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: repository.kind }),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch {
    return Response.json({ error: 'offline repository analysis is unavailable' }, { status: 503 });
  }
  if (!inspection) return Response.json({ error: 'offline repository analysis is unavailable' }, { status: 503 });
  const inspectionPayload = await inspection.json().catch(() => ({})) as Record<string, unknown>;
  if (!inspection.ok) {
    return Response.json({ error: 'repository analysis did not pass', detail: inspectionPayload.detail }, { status: inspection.status });
  }

  let finalize: Response | null;
  try {
    finalize = await runtimeFetch(
      locals,
      `/v1/repositories/${repository.id}/revisions/${repository.revision_id}/finalize`,
      { method: 'POST', signal: AbortSignal.timeout(30_000) },
    );
  } catch {
    return Response.json({ error: 'revision could not be finalized' }, { status: 503 });
  }
  if (!finalize) return Response.json({ error: 'revision could not be finalized' }, { status: 503 });
  const finalized = await finalize.json().catch(() => ({})) as Record<string, unknown>;
  if (!finalize.ok) {
    return Response.json({ error: 'revision is not ready for human review', detail: finalized.detail }, { status: finalize.status });
  }

  try {
    await sql`
      insert into app.notifications (profile_id, event_type, title, body, href, metadata)
      values (
        ${profile.profileId}::uuid,
        'repository.review_submitted',
        'Repository submitted for review ✅',
        'All automated checks passed. A human reviewer will make the final publication decision.',
        ${`/repositories/${repository.id}/edit`},
        ${JSON.stringify({ repository_id: repository.id, revision_id: repository.revision_id })}::jsonb
      )
    `;
  } catch {
    // Submission is complete even when the optional notification write fails.
  }
  return Response.json({ ok: true, status: 'review', revision: finalized, analysis: inspectionPayload });
};
