import type { APIRoute } from 'astro';
import { authorizeAgentToken } from '@/lib/agent-auth';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { UUID_PATTERN } from '@/lib/agent-management';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const receiptId = params.receiptId ?? '';
  if (!UUID_PATTERN.test(receiptId)) return Response.json({ error: 'receipt not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const hasBearer = Boolean(request.headers.get('authorization'));
  let agentIdentityId: string | null = null;
  let profileId: string | null = null;
  if (hasBearer) {
    const authorization = await authorizeAgentToken(request, sql, 'receipts:read');
    if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
    agentIdentityId = authorization.actor.agentIdentityId;
  } else {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
    profileId = profile.profileId;
  }
  const rows = await sql`
    select receipt.id, receipt.sequence, receipt.agent_identity_id,
           identity.handle as agent_handle, receipt.idempotency_key,
           receipt.action, receipt.target_type, receipt.target_id,
           receipt.target_ref, receipt.requested_scopes,
           receipt.request_sha256, receipt.result_sha256, receipt.status,
           receipt.review_boundary, receipt.detail, receipt.occurred_at
    from app.agent_action_receipts receipt
    join app.agent_identities identity on identity.id = receipt.agent_identity_id
    where receipt.id = ${receiptId}::uuid
      and (
        (${agentIdentityId}::uuid is not null and receipt.agent_identity_id = ${agentIdentityId}::uuid)
        or (${profileId}::uuid is not null and exists (
          select 1 from app.organization_members member
          where member.organization_id = receipt.operator_organization_id
            and member.profile_id = ${profileId}::uuid
            and member.role in ('owner', 'admin')
        ))
      )
    limit 1
  `;
  if (!rows.length) return Response.json({ error: 'receipt not found' }, { status: 404 });
  return Response.json({ receipt: rows[0] }, { headers: { 'cache-control': 'private, no-store' } });
};
