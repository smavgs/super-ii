import type { NeonQueryFunction } from '@neondatabase/serverless';
import { runtimeValue } from './db';
import {
  transferCapabilityHash,
  transferTokenFrom,
  verifyTransferTicket,
  type TransferTicket,
} from './transfer-ticket';

export const TUS_VERSION = '1.0.0';
export const TUS_EXTENSIONS = 'creation,expiration,checksum,termination';
export const MAX_TRANSFER_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_TRANSFER_CHUNK_BYTES = 32 * 1024 * 1024;

export type TransferRow = {
  id: string;
  repository_id: string;
  revision_id: string;
  uploader_profile_id: string;
  path: string;
  filename: string | null;
  mime_type: string;
  expected_size_bytes: string;
  expected_sha256: string;
  actual_sha256: string | null;
  offset_bytes: string;
  state: string;
  capability_hash: string;
  expires_at: string;
  repository_file_id: string | null;
  receipt: Record<string, unknown>;
  error_code: string | null;
};

export type AuthorizedTransfer = {
  row: TransferRow;
  ticket: TransferTicket;
  token: string;
};

export async function authorizedTransfer(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  transferId: string,
): Promise<AuthorizedTransfer | null> {
  const secret = runtimeValue(locals, 'CONTACT_HASH_SALT');
  const token = transferTokenFrom(request);
  if (!secret || !token) return null;
  let ticket: TransferTicket | null;
  try {
    ticket = await verifyTransferTicket(secret, token);
  } catch {
    return null;
  }
  if (!ticket || ticket.transferId !== transferId) return null;
  const capabilityHash = await transferCapabilityHash(token);
  try {
    const rows = await sql`
      select
        id, repository_id, revision_id, uploader_profile_id, path, filename,
        mime_type, expected_size_bytes, expected_sha256, actual_sha256,
        offset_bytes, state, capability_hash, expires_at, repository_file_id,
        receipt, error_code
      from app.repository_uploads
      where id = ${transferId}::uuid
        and repository_id = ${ticket.repositoryId}::uuid
        and revision_id = ${ticket.revisionId}::uuid
        and uploader_profile_id = ${ticket.profileId}::uuid
        and expected_size_bytes = ${ticket.sizeBytes}
        and expected_sha256 = ${ticket.sha256}
        and capability_hash = ${capabilityHash}
        and expires_at > now()
      limit 1
    ` as TransferRow[];
    return rows[0] ? { row: rows[0], ticket, token } : null;
  } catch {
    return null;
  }
}

export function tusHeaders(row?: TransferRow): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'tus-resumable': TUS_VERSION,
  });
  if (row) {
    headers.set('upload-offset', row.offset_bytes);
    headers.set('upload-length', row.expected_size_bytes);
    headers.set('upload-expires', new Date(row.expires_at).toUTCString());
    headers.set('upload-complete', ['uploaded', 'scanning', 'ready'].includes(row.state) ? 'true' : 'false');
  }
  return headers;
}

export function tusOptionsResponse(): Response {
  const headers = tusHeaders();
  headers.set('tus-version', TUS_VERSION);
  headers.set('tus-extension', TUS_EXTENSIONS);
  headers.set('tus-checksum-algorithm', 'sha1,sha256');
  headers.set('tus-max-size', String(MAX_TRANSFER_BYTES));
  return new Response(null, { status: 204, headers });
}

export function copyTusResponse(upstream: Response): Response {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of [
    'tus-resumable',
    'tus-version',
    'tus-extension',
    'tus-checksum-algorithm',
    'tus-max-size',
    'upload-offset',
    'upload-length',
    'upload-expires',
    'upload-complete',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
