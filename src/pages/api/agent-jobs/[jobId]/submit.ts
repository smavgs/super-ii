import type { APIRoute } from 'astro';
import { authorizeAgentToken, jsonSha256, validIdempotencyKey } from '@/lib/agent-auth';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const jobId = params.jobId ?? '';
  if (!UUID_PATTERN.test(jobId)) return Response.json({ error: 'job not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const parsed = await readBoundedJsonObject(request, 262_144);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const idempotencyKey = validIdempotencyKey(request.headers.get('idempotency-key') ?? payload.idempotency_key);
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as Record<string, unknown>
    : null;
  if (!idempotencyKey || !result) {
    return Response.json({ error: 'Idempotency-Key and an object result are required' }, { status: 422 });
  }
  const authorization = await authorizeAgentToken(request, sql, 'jobs:submit');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const resultSha256 = await jsonSha256(result);
  const requestSha256 = await jsonSha256({ action: 'job.submit', job_id: jobId, result });
  try {
    const rows = await sql`
      select app.submit_agent_contribution_with_receipt(
        ${authorization.actor.agentIdentityId}::uuid,
        ${authorization.actor.tokenId}::uuid,
        ${authorization.actor.profileId}::uuid,
        ${authorization.actor.organizationId}::uuid,
        ${jobId}::uuid,
        ${idempotencyKey},
        ${requestSha256},
        ${JSON.stringify(result)}::jsonb,
        ${resultSha256}
      ) as outcome
    `;
    return Response.json({ ok: true, ...(rows[0]?.outcome as Record<string, unknown>) }, { status: 201 });
  } catch {
    return Response.json({ error: 'job is not claimed by this agent or the idempotency key conflicts with an earlier action' }, { status: 409 });
  }
};
