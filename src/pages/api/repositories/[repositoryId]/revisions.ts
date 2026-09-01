import type { APIRoute } from 'astro';
import { jsonSha256, validIdempotencyKey } from '@/lib/agent-auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { managedRepository, scopedManagedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:commit');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId)
    : await scopedManagedRepository(sql, repositoryId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const branchId = textValue(payload.branch_id, 36) || repository.branch_id;
  const message = textValue(payload.message, 2000) || 'Update repository';
  if (authorization.actor.kind === 'agent-token') {
    const idempotencyKey = validIdempotencyKey(request.headers.get('idempotency-key') ?? payload.idempotency_key);
    if (!idempotencyKey) {
      return Response.json({ error: 'agent revisions require an Idempotency-Key with 16-200 safe characters' }, { status: 422 });
    }
    const requestSha256 = await jsonSha256({
      action: 'revision.create', repository_id: repository.id,
      branch_id: branchId, message,
    });
    try {
      const rows = await sql`
        select app.agent_create_revision_with_receipt(
          ${authorization.actor.agentIdentityId}::uuid,
          ${authorization.actor.tokenId}::uuid,
          ${authorization.actor.profileId}::uuid,
          ${authorization.actor.organizationId}::uuid,
          ${repository.id}::uuid,
          ${branchId}::uuid,
          ${message},
          ${idempotencyKey},
          ${requestSha256}
        ) as outcome
      `;
      const outcome = rows[0]?.outcome as Record<string, unknown>;
      return Response.json({
        ok: true,
        ...outcome,
        edit_href: `/repositories/${repository.id}/edit?branch=${encodeURIComponent(branchId)}`,
      }, { status: outcome?.replayed === true ? 200 : 201 });
    } catch {
      return Response.json({ error: 'finish or submit the current revision, or use a new idempotency key for a new action' }, { status: 409 });
    }
  }
  try {
    const rows = await sql`
      select * from app.create_repository_commit(
        ${repository.id}::uuid,
        ${branchId}::uuid,
        ${message},
        ${authorization.actor.createdBy}
      )
    `;
    return Response.json({
      ok: true,
      revision: rows[0],
      edit_href: `/repositories/${repository.id}/edit?branch=${encodeURIComponent(branchId)}`,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'finish or submit the current editable revision before creating another commit' }, { status: 409 });
  }
};
