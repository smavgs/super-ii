import type { APIRoute } from 'astro';
import { managedRepository, scopedManagedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

const traceIdPattern = /^[A-Za-z0-9._:-]{8,200}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const forbiddenMetadataKey = /(authorization|cookie|password|passwd|secret|token|credential|private[_-]?key|prompt|input|output|content)/i;

function metadataIsSafe(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => metadataIsSafe(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 100 && entries.every(([key, item]) => (
    key.length <= 100
    && !forbiddenMetadataKey.test(key)
    && metadataIsSafe(item, depth + 1)
  ));
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:trace');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId)
    : await scopedManagedRepository(sql, repositoryId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  const rate = await consumeRateLimit(locals, request, sql, 'repository.trace', 1000, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'agent trace rate limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const traceId = textValue(body.trace_id, 200);
  const agentName = textValue(body.agent_name, 200);
  const toolName = textValue(body.tool_name, 200) || null;
  const status = textValue(body.status, 20);
  const revisionId = textValue(body.revision_id, 36) || null;
  const inputSha256 = textValue(body.input_sha256, 64) || null;
  const outputSha256 = textValue(body.output_sha256, 64) || null;
  const durationMs = typeof body.duration_ms === 'number' && Number.isInteger(body.duration_ms) ? body.duration_ms : null;
  const metadata = body.metadata ?? {};
  const occurredAt = typeof body.occurred_at === 'string' && !Number.isNaN(Date.parse(body.occurred_at))
    ? new Date(body.occurred_at)
    : new Date();
  const now = Date.now();
  if (
    !traceIdPattern.test(traceId)
    || !agentName
    || !['succeeded', 'failed', 'cancelled'].includes(status)
    || (revisionId !== null && !/^[0-9a-f-]{36}$/i.test(revisionId))
    || (inputSha256 !== null && !sha256Pattern.test(inputSha256))
    || (outputSha256 !== null && !sha256Pattern.test(outputSha256))
    || durationMs === null
    || durationMs < 0
    || durationMs > 86_400_000
    || occurredAt.getTime() > now + 5 * 60_000
    || occurredAt.getTime() < now - 30 * 24 * 60 * 60_000
    || !metadataIsSafe(metadata)
    || JSON.stringify(metadata).length > 16_384
  ) {
    return Response.json({ error: 'trace metadata is invalid, too large, too old, or contains sensitive fields' }, { status: 422 });
  }
  if (revisionId) {
    try {
      const revisions = await sql`
        select id from app.repository_revisions
        where id = ${revisionId}::uuid and repository_id = ${repository.id}::uuid
      `;
      if (!revisions.length) return Response.json({ error: 'revision does not belong to this repository' }, { status: 422 });
    } catch {
      return Response.json({ error: 'revision could not be verified' }, { status: 503 });
    }
  }
  const requestedPublic = body.is_public === true;
  const isPublic = authorization.actor.kind === 'profile' && requestedPublic;
  try {
    const rows = await sql`
      insert into app.agent_traces (
        repository_id, revision_id, actor_profile_id, service_account_id,
        trusted_publisher_id, trace_id, agent_name, tool_name, status,
        duration_ms, input_sha256, output_sha256, metadata, is_public, occurred_at
      ) values (
        ${repository.id}::uuid,
        ${revisionId}::uuid,
        ${authorization.actor.kind === 'profile' ? authorization.actor.profileId : null}::uuid,
        ${authorization.actor.serviceAccountId}::uuid,
        ${authorization.actor.trustedPublisherId}::uuid,
        ${traceId}, ${agentName}, ${toolName}, ${status}, ${durationMs},
        ${inputSha256}, ${outputSha256}, ${JSON.stringify(metadata)}::jsonb,
        ${isPublic}, ${occurredAt.toISOString()}::timestamptz
      )
      returning id, trace_id, is_public, occurred_at
    `;
    return Response.json({ ok: true, trace: rows[0] }, { status: 201 });
  } catch {
    return Response.json({ error: 'trace ID already exists or the trace could not be recorded' }, { status: 409 });
  }
};
