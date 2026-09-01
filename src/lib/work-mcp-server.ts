import type { NeonQueryFunction } from '@neondatabase/serverless';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import {
  authorizeAgentToken,
  existingAgentReceipt,
  jsonSha256,
  recordAgentReceipt,
} from './agent-auth';
import { UUID_PATTERN } from './agent-management';
import { repositorySlugPattern, safeRepositoryPath } from './creator';
import { runtimeValue, sqlClient } from './db';
import { runtimeFetch, runtimeIsConfigured } from './runtime';
import { signTransferTicket, transferCapabilityHash, type TransferTicket } from './transfer-ticket';
import { MAX_TRANSFER_BYTES, MAX_TRANSFER_CHUNK_BYTES, TUS_VERSION } from './transfers';

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const idempotency = z.string().trim().min(16).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/)
  .describe('A stable per-action key. Reuse it only when retrying the exact same request.');
const uuid = z.string().regex(UUID_PATTERN);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

type AgentRepository = {
  id: string;
  kind: 'model' | 'dataset' | 'space';
  owner_handle: string;
  slug: string;
  revision_id: string;
  revision_status: string;
  branch_id: string;
  branch_name: string;
};

function toolResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (text.length > 240_000) return toolError('bounded Work MCP response size exceeded');
  return { content: [{ type: 'text' as const, text }] };
}

function toolError(message: string, detail?: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, detail: detail ?? null }) }],
  };
}

async function agentRepository(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  repositoryId: string,
  branchId: string | null = null,
): Promise<AgentRepository | null> {
  if (!UUID_PATTERN.test(repositoryId) || (branchId && !UUID_PATTERN.test(branchId))) return null;
  const rows = await sql`
    select repository.id, repository.kind, repository.owner_handle, repository.slug,
           revision.id as revision_id, revision.status as revision_status,
           branch.id as branch_id, branch.name as branch_name
    from app.repositories repository
    join app.repository_branches branch
      on branch.repository_id = repository.id
      and (
        (${branchId}::uuid is null and branch.is_default)
        or branch.id = ${branchId}::uuid
      )
    join app.repository_revisions revision on revision.id = branch.head_revision_id
    where repository.id = ${repositoryId}::uuid
      and repository.owner_organization_id = ${organizationId}::uuid
    limit 1
  `;
  return (rows[0] as AgentRepository | undefined) ?? null;
}

function publicHref(origin: string, kind: string, owner: string, slug: string): string {
  const prefix = kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
  return new URL(`/${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`, origin).toString();
}

export function createSuperiiWorkMcpServer(
  locals: App.Locals,
  origin: string,
  request: Request,
): McpServer {
  const server = new McpServer(
    { name: 'Super ii authenticated Work MCP', version: '1.0.0' },
    {
      instructions: 'Authenticated and review-bound. Never reveal the bearer token or transfer capability. Reuse an idempotency key only for an exact retry. Use prepare_resumable_upload for bytes, verify checksums, and stop at human review. This server cannot publish, delete, pay, expand scopes, or change operators.',
    },
  );

  server.registerTool(
    'create_draft_repository',
    {
      title: 'Create a review-bound draft repository',
      description: 'Create a public-intent model, dataset, or app draft owned by the token operator organization. Publication still requires clean files and human review.',
      inputSchema: z.object({
        idempotency_key: idempotency,
        kind: z.enum(['model', 'dataset', 'space']),
        slug: z.string().trim().min(1).max(96).regex(repositorySlugPattern),
        title: z.string().trim().min(2).max(200),
        summary: z.string().trim().min(10).max(2000),
        license: z.string().trim().max(120).optional(),
        task: z.string().trim().max(120).optional(),
        library: z.string().trim().max(120).optional(),
        modality: z.string().trim().max(120).optional(),
        card_markdown: z.string().max(100_000).default(''),
        source_urls: z.array(z.url().refine((value) => value.startsWith('https://'))).max(50).default([]),
      }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'repository:create');
      if (!authorization.ok) return toolError(authorization.error);
      const requestHash = await jsonSha256(input);
      try {
        const rows = await sql`
          select app.agent_create_repository_with_receipt(
            ${authorization.actor.agentIdentityId}::uuid,
            ${authorization.actor.tokenId}::uuid,
            ${authorization.actor.profileId}::uuid,
            ${authorization.actor.organizationId}::uuid,
            ${input.idempotency_key}, ${requestHash}, ${input.kind}::repository_kind,
            ${input.slug}, ${input.title}, ${input.summary}, ${input.license ?? null},
            ${input.task ?? null}, ${input.library ?? null}, ${input.modality ?? null},
            ${input.card_markdown}, ${JSON.stringify({ sources: input.source_urls })}::jsonb
          ) as outcome
        `;
        const outcome = rows[0]?.outcome as Record<string, unknown> | undefined;
        const created = outcome?.result as Record<string, unknown> | undefined;
        const ownerRows = await sql`
          select owner_handle from app.repositories where id = ${String(created?.repository_id ?? '')}::uuid
        `;
        return toolResult({
          ...outcome,
          edit_url: new URL(`/repositories/${String(created?.repository_id)}/edit`, origin).toString(),
          public_url: publicHref(origin, input.kind, String(ownerRows[0]?.owner_handle ?? ''), input.slug),
          publication_state: 'draft',
          human_review_required: true,
        });
      } catch {
        return toolError('repository slug is unavailable, access changed, or the idempotency key conflicts');
      }
    },
  );

  server.registerTool(
    'create_revision',
    {
      title: 'Create a repository revision',
      description: 'Create the next editable revision on an organization-owned branch. Existing clean files are copied; the new revision remains review-bound.',
      inputSchema: z.object({
        idempotency_key: idempotency,
        repository_id: uuid,
        branch_id: uuid.optional(),
        message: z.string().trim().min(1).max(2000).default('Agent update'),
      }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'repository:commit', input.repository_id);
      if (!authorization.ok) return toolError(authorization.error);
      const repository = await agentRepository(sql, authorization.actor.organizationId, input.repository_id, input.branch_id ?? null);
      if (!repository) return toolError('organization-owned repository or branch not found');
      const requestHash = await jsonSha256({ ...input, branch_id: repository.branch_id });
      try {
        const rows = await sql`
          select app.agent_create_revision_with_receipt(
            ${authorization.actor.agentIdentityId}::uuid,
            ${authorization.actor.tokenId}::uuid,
            ${authorization.actor.profileId}::uuid,
            ${authorization.actor.organizationId}::uuid,
            ${repository.id}::uuid, ${repository.branch_id}::uuid,
            ${input.message}, ${input.idempotency_key}, ${requestHash}
          ) as outcome
        `;
        return toolResult({
          ...(rows[0]?.outcome as Record<string, unknown>),
          edit_url: new URL(`/repositories/${repository.id}/edit?branch=${encodeURIComponent(repository.branch_id)}`, origin).toString(),
          human_review_required: true,
        });
      } catch {
        return toolError('finish or submit the current editable revision, or use a new idempotency key for a new action');
      }
    },
  );

  server.registerTool(
    'prepare_resumable_upload',
    {
      title: 'Prepare a resumable repository upload',
      description: 'Create a bounded tus upload capability for one declared file. The returned transfer token authorizes only that file, size, checksum, revision, and expiry.',
      inputSchema: z.object({
        idempotency_key: idempotency,
        repository_id: uuid,
        branch_id: uuid.optional(),
        path: z.string().trim().min(1).max(1024),
        filename: z.string().trim().min(1).max(255),
        mime_type: z.string().trim().min(3).max(255).default('application/octet-stream'),
        length: z.number().int().min(1).max(MAX_TRANSFER_BYTES),
        sha256,
      }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'repository:upload', input.repository_id);
      if (!authorization.ok) return toolError(authorization.error);
      const path = safeRepositoryPath(input.path);
      if (!path) return toolError('repository path is unsafe');
      const repository = await agentRepository(sql, authorization.actor.organizationId, input.repository_id, input.branch_id ?? null);
      if (!repository) return toolError('organization-owned repository or branch not found');
      if (!['draft', 'quarantined'].includes(repository.revision_status)) return toolError('revision is not accepting uploads');
      if (!runtimeIsConfigured(locals)) return toolError('secure transfer runtime is unavailable');
      const ticketSecret = runtimeValue(locals, 'CONTACT_HASH_SALT');
      if (!ticketSecret || ticketSecret.length < 32) return toolError('transfer capability signing is unavailable');
      const requestHash = await jsonSha256({ ...input, path, revision_id: repository.revision_id });

      try {
        const previous = await existingAgentReceipt(sql, authorization.actor, input.idempotency_key, 'transfer.create', requestHash);
        if (previous.conflict) return toolError('idempotency key conflicts with an earlier action');
        if (previous.receipt?.target_id) {
          const uploads = await sql`
            select id, repository_id, revision_id, uploader_profile_id,
                   expected_size_bytes, expected_sha256, expires_at, offset_bytes, state
            from app.repository_uploads
            where id = ${previous.receipt.target_id}::uuid and expires_at > now()
            limit 1
          `;
          const upload = uploads[0];
          if (!upload?.id) return toolError('the earlier transfer expired; use a new idempotency key');
          const expires = Math.floor(new Date(String(upload.expires_at)).getTime() / 1000);
          const transferToken = await signTransferTicket(ticketSecret, {
            version: 1,
            transferId: String(upload.id),
            repositoryId: String(upload.repository_id),
            revisionId: String(upload.revision_id),
            profileId: String(upload.uploader_profile_id),
            sizeBytes: Number(upload.expected_size_bytes),
            sha256: String(upload.expected_sha256),
            expires,
          });
          return toolResult({
            replayed: true,
            receipt: previous.receipt,
            transfer_id: upload.id,
            upload_url: new URL(`/api/transfers/${String(upload.id)}`, origin).toString(),
            transfer_token: transferToken,
            expires_at: upload.expires_at,
            upload_offset: Number(upload.offset_bytes),
            upload_length: Number(upload.expected_size_bytes),
            state: upload.state,
            max_chunk_bytes: MAX_TRANSFER_CHUNK_BYTES,
            protocol: `tus-${TUS_VERSION}`,
          });
        }

        const transferId = crypto.randomUUID();
        const expires = Math.floor(Date.now() / 1000) + 23 * 3600;
        const ticket: TransferTicket = {
          version: 1,
          transferId,
          repositoryId: repository.id,
          revisionId: repository.revision_id,
          profileId: authorization.actor.profileId,
          sizeBytes: input.length,
          sha256: input.sha256,
          expires,
        };
        const transferToken = await signTransferTicket(ticketSecret, ticket);
        const capabilityHash = await transferCapabilityHash(transferToken);
        const expiresAt = new Date(expires * 1000).toISOString();
        await sql`
          select * from app.create_resumable_upload(
            ${repository.id}::uuid, ${repository.revision_id}::uuid,
            ${authorization.actor.profileId}::uuid, ${path}, ${input.filename},
            ${input.mime_type.toLowerCase()}, ${input.length}, ${input.sha256},
            ${capabilityHash}, ${authorization.actor.createdBy}, ${expiresAt}::timestamptz,
            ${transferId}::uuid
          )
        `;
        let upstream: Response | null = null;
        try {
          upstream = await runtimeFetch(locals, '/v1/transfers', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'tus-resumable': TUS_VERSION },
            body: JSON.stringify({
              id: transferId,
              repository_id: repository.id,
              revision_id: repository.revision_id,
              path,
              filename: input.filename,
              mime_type: input.mime_type.toLowerCase(),
              created_by: authorization.actor.createdBy,
              length: input.length,
              expected_sha256: input.sha256,
              expires_at: expiresAt,
            }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          upstream = null;
        }
        if (!upstream?.ok) {
          await sql`
            update app.repository_uploads
            set state = 'aborted', error_code = 'transfer_runtime_unavailable',
                completed_at = now(), updated_at = now()
            where id = ${transferId}::uuid
          `.catch(() => undefined);
          return toolError('secure transfer runtime is unavailable');
        }
        const receiptDetail = {
          transfer_id: transferId,
          repository_id: repository.id,
          revision_id: repository.revision_id,
          path,
          length: input.length,
          sha256: input.sha256,
          expires_at: expiresAt,
          protocol: `tus-${TUS_VERSION}`,
        };
        let receipt: Awaited<ReturnType<typeof recordAgentReceipt>>;
        try {
          receipt = await recordAgentReceipt(sql, authorization.actor, {
            idempotencyKey: input.idempotency_key,
            action: 'transfer.create',
            targetType: 'transfer',
            targetId: transferId,
            targetRef: path,
            requestedScopes: ['repository:upload'],
            requestSha256: requestHash,
            resultSha256: await jsonSha256(receiptDetail),
            status: 'succeeded',
            reviewBoundary: 'human-review-required',
            detail: receiptDetail,
          });
        } catch {
          await sql`
            update app.repository_uploads
            set state = 'aborted', error_code = 'agent_receipt_unavailable',
                completed_at = now(), updated_at = now()
            where id = ${transferId}::uuid
          `.catch(() => undefined);
          await runtimeFetch(locals, `/v1/transfers/${transferId}`, { method: 'DELETE' }).catch(() => null);
          return toolError('transfer was cancelled because its immutable receipt could not be recorded');
        }
        return toolResult({
          replayed: false,
          receipt,
          transfer_id: transferId,
          upload_url: new URL(`/api/transfers/${transferId}`, origin).toString(),
          transfer_token: transferToken,
          expires_at: expiresAt,
          upload_offset: 0,
          upload_length: input.length,
          max_chunk_bytes: MAX_TRANSFER_CHUNK_BYTES,
          protocol: `tus-${TUS_VERSION}`,
        });
      } catch {
        return toolError('transfer could not be prepared or the idempotency key conflicts');
      }
    },
  );

  server.registerTool(
    'submit_revision_for_review',
    {
      title: 'Submit a clean revision for human review',
      description: 'Run fail-closed offline inspection and finalization, then place the revision in the human review queue. This tool cannot publish.',
      inputSchema: z.object({
        idempotency_key: idempotency,
        repository_id: uuid,
        branch_id: uuid.optional(),
      }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'repository:submit', input.repository_id);
      if (!authorization.ok) return toolError(authorization.error);
      const repository = await agentRepository(sql, authorization.actor.organizationId, input.repository_id, input.branch_id ?? null);
      if (!repository) return toolError('organization-owned repository or branch not found');
      const requestHash = await jsonSha256({ ...input, revision_id: repository.revision_id });
      try {
        const previous = await existingAgentReceipt(sql, authorization.actor, input.idempotency_key, 'revision.submit', requestHash);
        if (previous.conflict) return toolError('idempotency key conflicts with an earlier action');
        if (previous.receipt) return toolResult({ replayed: true, receipt: previous.receipt, ...previous.receipt.detail });
        if (!runtimeIsConfigured(locals)) return toolError('secure review runtime is unavailable');
        let inspection: Response | null;
        try {
          inspection = await runtimeFetch(locals, `/v1/repositories/${repository.id}/revisions/${repository.revision_id}/inspect`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: repository.kind }),
            signal: AbortSignal.timeout(120_000),
          });
        } catch {
          return toolError('offline repository analysis is unavailable');
        }
        const inspectionPayload = await inspection?.json().catch(() => ({})) as Record<string, unknown> | undefined;
        if (!inspection?.ok) return toolError('repository analysis did not pass', inspectionPayload?.detail);
        let finalize: Response | null;
        try {
          finalize = await runtimeFetch(locals, `/v1/repositories/${repository.id}/revisions/${repository.revision_id}/finalize`, {
            method: 'POST', signal: AbortSignal.timeout(30_000),
          });
        } catch {
          return toolError('revision could not be finalized');
        }
        const finalized = await finalize?.json().catch(() => ({})) as Record<string, unknown> | undefined;
        if (!finalize?.ok) return toolError('revision is not ready for human review', finalized?.detail);
        const detail = {
          repository_id: repository.id,
          revision_id: repository.revision_id,
          status: 'review',
          human_review_required: true,
          edit_url: new URL(`/repositories/${repository.id}/edit`, origin).toString(),
          analysis: inspectionPayload ?? {},
        };
        let receipt: Awaited<ReturnType<typeof recordAgentReceipt>>;
        try {
          receipt = await recordAgentReceipt(sql, authorization.actor, {
            idempotencyKey: input.idempotency_key,
            action: 'revision.submit',
            targetType: 'revision',
            targetId: repository.revision_id,
            targetRef: repository.id,
            requestedScopes: ['repository:submit'],
            requestSha256: requestHash,
            resultSha256: await jsonSha256(detail),
            status: 'succeeded',
            reviewBoundary: 'human-review-required',
            detail,
          });
        } catch {
          return toolError(
            'submission reached review but its immutable receipt could not be recorded; retry with the same idempotency key',
            { revision_id: repository.revision_id, retryable: true },
          );
        }
        return toolResult({ replayed: false, receipt, ...detail });
      } catch {
        return toolError('revision could not be submitted or the idempotency key conflicts');
      }
    },
  );

  server.registerTool(
    'claim_contribution_job',
    {
      title: 'Claim one contribution job',
      description: 'Atomically claim an open, review-bound contribution job and receive an immutable action receipt.',
      inputSchema: z.object({ idempotency_key: idempotency, job_id: uuid }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'jobs:claim');
      if (!authorization.ok) return toolError(authorization.error);
      const requestHash = await jsonSha256({ action: 'job.claim', job_id: input.job_id });
      const resultHash = await jsonSha256({ job_id: input.job_id, status: 'claimed' });
      try {
        const rows = await sql`
          select app.claim_agent_contribution_job_with_receipt(
            ${authorization.actor.agentIdentityId}::uuid,
            ${authorization.actor.tokenId}::uuid,
            ${authorization.actor.profileId}::uuid,
            ${authorization.actor.organizationId}::uuid,
            ${input.job_id}::uuid, ${input.idempotency_key}, ${requestHash}, ${resultHash}
          ) as outcome
        `;
        return toolResult(rows[0]?.outcome);
      } catch {
        return toolError('job is unavailable or the idempotency key conflicts');
      }
    },
  );

  server.registerTool(
    'submit_contribution_job',
    {
      title: 'Submit contribution evidence',
      description: 'Submit a structured result for a job claimed by this agent. A human owner/admin must accept it before reputation changes.',
      inputSchema: z.object({
        idempotency_key: idempotency,
        job_id: uuid,
        result: z.record(z.string(), z.unknown()),
      }).strict(),
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'jobs:submit');
      if (!authorization.ok) return toolError(authorization.error);
      const requestHash = await jsonSha256({ action: 'job.submit', job_id: input.job_id, result: input.result });
      const resultHash = await jsonSha256(input.result);
      try {
        const rows = await sql`
          select app.submit_agent_contribution_with_receipt(
            ${authorization.actor.agentIdentityId}::uuid,
            ${authorization.actor.tokenId}::uuid,
            ${authorization.actor.profileId}::uuid,
            ${authorization.actor.organizationId}::uuid,
            ${input.job_id}::uuid, ${input.idempotency_key}, ${requestHash},
            ${JSON.stringify(input.result)}::jsonb, ${resultHash}
          ) as outcome
        `;
        return toolResult(rows[0]?.outcome);
      } catch {
        return toolError('job is not claimed by this agent or the idempotency key conflicts');
      }
    },
  );

  server.registerTool(
    'get_action_receipt',
    {
      title: 'Get one immutable action receipt',
      description: 'Return one receipt owned by this agent identity. Tokens, transfer capabilities, and private payloads are excluded.',
      inputSchema: z.object({ receipt_id: uuid }).strict(),
      annotations: readAnnotations,
    },
    async ({ receipt_id }) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError('database unavailable');
      const authorization = await authorizeAgentToken(request, sql, 'receipts:read');
      if (!authorization.ok) return toolError(authorization.error);
      const rows = await sql`
        select id, sequence, agent_identity_id, idempotency_key, action,
               target_type, target_id, target_ref, requested_scopes,
               request_sha256, result_sha256, status, review_boundary,
               detail, occurred_at
        from app.agent_action_receipts
        where id = ${receipt_id}::uuid
          and agent_identity_id = ${authorization.actor.agentIdentityId}::uuid
        limit 1
      `;
      return rows.length ? toolResult({ receipt: rows[0] }) : toolError('receipt not found');
    },
  );

  return server;
}

export function createSuperiiWorkMcpHandler(locals: App.Locals, origin: string, request: Request) {
  return createMcpHandler(
    () => createSuperiiWorkMcpServer(locals, origin, request),
    {
      route: '/mcp/work',
      legacy: 'stateless',
      corsOptions: {
        origin: 'https://superii.site',
        methods: 'GET, POST, DELETE, OPTIONS',
        headers: 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
        exposeHeaders: 'mcp-session-id',
        maxAge: 86400,
      },
      allowedHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
      allowedOriginHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
    },
  );
}
