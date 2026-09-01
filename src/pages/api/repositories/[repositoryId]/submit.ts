import type { APIRoute } from 'astro';
import {
  existingAgentReceipt,
  jsonSha256,
  recordAgentReceipt,
  validIdempotencyKey,
  type AgentActor,
} from '@/lib/agent-auth';
import { managedRepository, scopedManagedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch, runtimeIsConfigured } from '@/lib/runtime';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:submit');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, repositoryId, branchId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  const idempotencyKey = authorization.actor.kind === 'agent-token'
    ? validIdempotencyKey(request.headers.get('idempotency-key'))
    : null;
  if (authorization.actor.kind === 'agent-token' && !idempotencyKey) {
    return Response.json({ error: 'agent submissions require an Idempotency-Key with 16-200 safe characters' }, { status: 422 });
  }
  const agentActor: AgentActor | null = authorization.actor.kind === 'agent-token'
    ? {
        kind: 'agent-token',
        tokenId: authorization.actor.tokenId ?? '',
        agentIdentityId: authorization.actor.agentIdentityId ?? '',
        profileId: authorization.actor.profileId,
        organizationId: authorization.actor.organizationId ?? '',
        grantedScopes: ['repository:submit'],
        boundRepositoryId: repository.id,
        createdBy: authorization.actor.createdBy,
      }
    : null;
  const requestSha256 = agentActor
    ? await jsonSha256({
        action: 'revision.submit', repository_id: repository.id,
        revision_id: repository.revision_id, branch_id: repository.branch_id,
      })
    : null;
  if (agentActor && idempotencyKey && requestSha256) {
    try {
      const previous = await existingAgentReceipt(
        sql, agentActor, idempotencyKey, 'revision.submit', requestSha256,
      );
      if (previous.conflict) return Response.json({ error: 'idempotency key conflicts with an earlier action' }, { status: 409 });
      if (previous.receipt) return Response.json({ ok: true, replayed: true, receipt: previous.receipt, ...previous.receipt.detail });
    } catch {
      return Response.json({ error: 'agent receipt service unavailable' }, { status: 503 });
    }
  }
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

  const detail = {
    status: 'review',
    repository_id: repository.id,
    revision_id: repository.revision_id,
    human_review_required: true,
    revision: finalized,
    analysis: inspectionPayload,
  };
  let receipt: unknown = null;
  if (agentActor && idempotencyKey && requestSha256) {
    try {
      receipt = await recordAgentReceipt(sql, agentActor, {
        idempotencyKey,
        action: 'revision.submit',
        targetType: 'revision',
        targetId: repository.revision_id,
        targetRef: repository.id,
        requestedScopes: ['repository:submit'],
        requestSha256,
        resultSha256: await jsonSha256(detail),
        status: 'succeeded',
        reviewBoundary: 'human-review-required',
        detail,
      });
    } catch {
      return Response.json({
        error: 'submission reached review but its immutable receipt could not be recorded; retry with the same Idempotency-Key',
        revision_id: repository.revision_id,
        retryable: true,
      }, { status: 503 });
    }
  }
  try {
    await sql`
      insert into app.notifications (profile_id, event_type, title, body, href, metadata)
      values (
        ${authorization.actor.profileId}::uuid,
        'repository.review_submitted',
        'Repository submitted for review ✅',
        'All automated checks passed. A human reviewer will make the final publication decision.',
        ${`/repositories/${repository.id}/edit`},
        ${JSON.stringify({ repository_id: repository.id, revision_id: repository.revision_id })}::jsonb
      )
    `;
  } catch {
    // Submission and its receipt are complete even when the optional notification write fails.
  }
  return Response.json({ ok: true, replayed: false, receipt, ...detail });
};
