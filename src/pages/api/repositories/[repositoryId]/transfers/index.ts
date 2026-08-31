import type { APIRoute } from 'astro';
import { managedRepository, safeRepositoryPath, scopedManagedRepository, textValue } from '@/lib/creator';
import { runtimeValue, sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch, runtimeIsConfigured } from '@/lib/runtime';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';
import {
  signTransferTicket,
  transferCapabilityHash,
  type TransferTicket,
} from '@/lib/transfer-ticket';
import {
  MAX_TRANSFER_BYTES,
  MAX_TRANSFER_CHUNK_BYTES,
  TUS_VERSION,
  tusOptionsResponse,
} from '@/lib/transfers';

const SHA256 = /^[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export const OPTIONS: APIRoute = async () => tusOptionsResponse();

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'expected JSON' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) {
    return Response.json({ error: 'transfer request is too large' }, { status: 413 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(
    locals,
    request,
    sql,
    repositoryId,
    'repository:upload',
  );
  if (!authorization.ok) {
    return Response.json({ error: authorization.error }, { status: authorization.status });
  }
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, repositoryId, branchId);
  if (!repository) {
    return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  }
  if (!['draft', 'quarantined'].includes(repository.revision_status)) {
    return Response.json({ error: 'this revision is not accepting uploads' }, { status: 409 });
  }
  if (!runtimeIsConfigured(locals)) {
    return Response.json({ error: 'secure transfer runtime is unavailable' }, { status: 503 });
  }
  const ticketSecret = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!ticketSecret || ticketSecret.length < 32) {
    return Response.json({ error: 'transfer capability signing is unavailable' }, { status: 503 });
  }
  const rateLimit = await consumeRateLimit(locals, request, sql, 'repository.transfer.create', 100, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'transfer creation limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503 },
    );
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const path = safeRepositoryPath(input.path);
  const filename = textValue(input.filename, 255);
  const mimeTypeValue = textValue(input.mime_type, 255).toLowerCase();
  const mimeType = MIME.test(mimeTypeValue) ? mimeTypeValue : 'application/octet-stream';
  const length = Number(input.length);
  const expectedSha256 = typeof input.sha256 === 'string' ? input.sha256 : '';
  if (
    !path
    || !filename
    || !Number.isSafeInteger(length)
    || length < 1
    || length > MAX_TRANSFER_BYTES
    || !SHA256.test(expectedSha256)
  ) {
    return Response.json({
      error: 'safe path, filename, size from 1 byte to 10 GiB, and lowercase SHA-256 are required',
    }, { status: 422 });
  }

  const transferId = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + 23 * 3600;
  const ticketPayload: TransferTicket = {
    version: 1,
    transferId,
    repositoryId: repository.id,
    revisionId: repository.revision_id,
    profileId: authorization.actor.profileId,
    sizeBytes: length,
    sha256: expectedSha256,
    expires,
  };
  let transferToken: string;
  try {
    transferToken = await signTransferTicket(ticketSecret, ticketPayload);
  } catch {
    return Response.json({ error: 'transfer capability could not be created' }, { status: 503 });
  }
  const capabilityHash = await transferCapabilityHash(transferToken);
  const expiresAt = new Date(expires * 1000).toISOString();

  try {
    await sql`
      select *
      from app.create_resumable_upload(
        ${repository.id}::uuid,
        ${repository.revision_id}::uuid,
        ${authorization.actor.profileId}::uuid,
        ${path},
        ${filename},
        ${mimeType},
        ${length},
        ${expectedSha256},
        ${capabilityHash},
        ${authorization.actor.createdBy},
        ${expiresAt}::timestamptz,
        ${transferId}::uuid
      )
    `;
  } catch {
    return Response.json({ error: 'an active transfer already exists for this path' }, { status: 409 });
  }

  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(locals, '/v1/transfers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'tus-resumable': TUS_VERSION,
      },
      body: JSON.stringify({
        id: transferId,
        repository_id: repository.id,
        revision_id: repository.revision_id,
        path,
        filename,
        mime_type: mimeType,
        created_by: authorization.actor.createdBy,
        length,
        expected_sha256: expectedSha256,
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
    return Response.json({ error: 'secure transfer runtime is unavailable' }, { status: 503 });
  }

  const uploadUrl = new URL('/api/transfers/' + transferId, request.url).toString();
  const headers = new Headers({
    'cache-control': 'no-store',
    'location': uploadUrl,
    'tus-resumable': TUS_VERSION,
    'upload-expires': new Date(expires * 1000).toUTCString(),
    'upload-offset': '0',
  });
  return Response.json({
    transfer_id: transferId,
    upload_url: uploadUrl,
    transfer_token: transferToken,
    expires_at: expiresAt,
    upload_offset: 0,
    upload_length: length,
    max_chunk_bytes: MAX_TRANSFER_CHUNK_BYTES,
    protocol: 'tus-1.0.0',
  }, { status: 201, headers });
};
