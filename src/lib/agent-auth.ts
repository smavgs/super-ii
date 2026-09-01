import type { NeonQueryFunction } from '@neondatabase/serverless';
import { sha256Hex } from './scoped-auth';

export const agentScopes = [
  'repository:create',
  'repository:upload',
  'repository:commit',
  'repository:submit',
  'events:read',
  'receipts:read',
  'jobs:claim',
  'jobs:submit',
] as const;

export type AgentScope = (typeof agentScopes)[number];

export type AgentActor = {
  kind: 'agent-token';
  tokenId: string;
  agentIdentityId: string;
  profileId: string;
  organizationId: string;
  grantedScopes: AgentScope[];
  boundRepositoryId: string | null;
  createdBy: string;
};

export type AgentAuthorization =
  | { ok: true; actor: AgentActor; token: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type AgentReceipt = {
  id: string;
  sequence: number;
  agent_identity_id: string;
  token_id: string | null;
  idempotency_key: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_ref: string | null;
  request_sha256: string;
  result_sha256: string | null;
  status: 'succeeded' | 'rejected' | 'failed';
  review_boundary: 'human-review-required' | 'human-approved' | 'not-applicable';
  detail: Record<string, unknown>;
  occurred_at: string;
};

const agentTokenPattern = /^sii_agent_[a-z0-9]{40,128}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;

export function agentBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return agentTokenPattern.test(token) ? token : null;
}

export function validIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return idempotencyPattern.test(key) ? key : null;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export async function jsonSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export function generateAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sii_agent_${secret}`;
}

export async function authorizeAgentToken(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  scope: AgentScope,
  repositoryId: string | null = null,
): Promise<AgentAuthorization> {
  const authorization = request.headers.get('authorization');
  const token = agentBearerToken(request);
  if (!authorization) return { ok: false, status: 401, error: 'agent bearer token required' };
  if (!token) return { ok: false, status: 401, error: 'invalid agent bearer token' };

  try {
    const tokenHash = await sha256Hex(token);
    const rows = await sql`
      select * from app.consume_agent_access_token(
        ${tokenHash},
        ${scope},
        ${repositoryId}::uuid
      )
    `;
    const row = rows[0];
    if (!row?.token_id) {
      return { ok: false, status: 403, error: 'agent token is expired, revoked, exhausted, out of scope, or bound elsewhere' };
    }
    const grantedScopes = Array.isArray(row.granted_scopes)
      ? row.granted_scopes.filter((value): value is AgentScope => agentScopes.includes(value as AgentScope))
      : [];
    return {
      ok: true,
      token,
      actor: {
        kind: 'agent-token',
        tokenId: String(row.token_id),
        agentIdentityId: String(row.agent_identity_id),
        profileId: String(row.operator_profile_id),
        organizationId: String(row.operator_organization_id),
        grantedScopes,
        boundRepositoryId: row.bound_repository_id ? String(row.bound_repository_id) : null,
        createdBy: `agent:${String(row.agent_identity_id)}`,
      },
    };
  } catch {
    return { ok: false, status: 503, error: 'agent authorization service unavailable' };
  }
}

export async function existingAgentReceipt(
  sql: NeonQueryFunction<false, false>,
  actor: AgentActor,
  idempotencyKey: string,
  action: string,
  requestSha256: string,
): Promise<{ receipt: AgentReceipt | null; conflict: boolean }> {
  const rows = await sql`
    select id, sequence, agent_identity_id, token_id, idempotency_key, action,
           target_type, target_id, target_ref, request_sha256, result_sha256,
           status, review_boundary, detail, occurred_at
    from app.agent_action_receipts
    where agent_identity_id = ${actor.agentIdentityId}::uuid
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const receipt = (rows[0] as AgentReceipt | undefined) ?? null;
  return {
    receipt,
    conflict: Boolean(receipt && (receipt.action !== action || receipt.request_sha256 !== requestSha256)),
  };
}

export async function recordAgentReceipt(
  sql: NeonQueryFunction<false, false>,
  actor: AgentActor,
  input: {
    idempotencyKey: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetRef?: string | null;
    requestedScopes: AgentScope[];
    requestSha256: string;
    resultSha256?: string | null;
    status: 'succeeded' | 'rejected' | 'failed';
    reviewBoundary: 'human-review-required' | 'human-approved' | 'not-applicable';
    detail?: Record<string, unknown>;
  },
): Promise<AgentReceipt> {
  const rows = await sql`
    select * from app.record_agent_action_receipt(
      ${actor.agentIdentityId}::uuid,
      ${actor.tokenId}::uuid,
      ${actor.profileId}::uuid,
      ${actor.organizationId}::uuid,
      ${input.idempotencyKey},
      ${input.action},
      ${input.targetType},
      ${input.targetId ?? null}::uuid,
      ${input.targetRef ?? null},
      ${input.requestedScopes},
      ${input.requestSha256},
      ${input.resultSha256 ?? null},
      ${input.status},
      ${input.reviewBoundary},
      ${JSON.stringify(input.detail ?? {})}::jsonb
    )
  `;
  const receipt = rows[0] as AgentReceipt | undefined;
  if (!receipt?.id) throw new Error('agent receipt was not recorded');
  return receipt;
}

export function receiptResponse(receipt: AgentReceipt, replayed = false): Record<string, unknown> {
  return {
    ok: receipt.status === 'succeeded',
    replayed,
    receipt: {
      id: receipt.id,
      sequence: Number(receipt.sequence),
      action: receipt.action,
      target_type: receipt.target_type,
      target_id: receipt.target_id,
      target_ref: receipt.target_ref,
      request_sha256: receipt.request_sha256,
      result_sha256: receipt.result_sha256,
      status: receipt.status,
      review_boundary: receipt.review_boundary,
      detail: receipt.detail,
      occurred_at: receipt.occurred_at,
    },
  };
}
