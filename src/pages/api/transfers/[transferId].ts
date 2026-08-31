import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { runtimeFetch } from '@/lib/runtime';
import {
  authorizedTransfer,
  copyTusResponse,
  MAX_TRANSFER_CHUNK_BYTES,
  TUS_VERSION,
  tusOptionsResponse,
} from '@/lib/transfers';

function validTusVersion(request: Request): boolean {
  return request.headers.get('tus-resumable') === TUS_VERSION;
}

function tusVersionError(): Response {
  return Response.json(
    { error: 'unsupported tus version' },
    { status: 412, headers: { 'cache-control': 'no-store', 'tus-version': TUS_VERSION } },
  );
}

export const OPTIONS: APIRoute = async () => tusOptionsResponse();

export const HEAD: APIRoute = async ({ locals, params, request }) => {
  if (!validTusVersion(request)) return tusVersionError();
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const transferId = params.transferId ?? '';
  const transfer = await authorizedTransfer(locals, request, sql, transferId);
  if (!transfer) return Response.json({ error: 'transfer not found or capability expired' }, { status: 404 });
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(locals, '/v1/transfers/' + transferId, {
      method: 'HEAD',
      headers: { 'tus-resumable': TUS_VERSION },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    upstream = null;
  }
  if (!upstream) return Response.json({ error: 'transfer runtime unavailable' }, { status: 503 });
  if (!upstream.ok) {
    if ([404, 410].includes(upstream.status)) {
      if (transfer.row.repository_file_id || transfer.row.state === 'scanning') {
        return Response.json({ error: 'transfer state requires operator repair' }, { status: 503 });
      }
      try {
        const retired = await sql`
          update app.repository_uploads
          set state = 'aborted', error_code = 'transfer_runtime_state_missing',
              completed_at = now(), updated_at = now()
          where id = ${transferId}::uuid
            and state in ('initiated', 'uploading', 'uploaded')
          returning id
        `;
        if (!retired[0]) {
          return Response.json({ error: 'transfer state requires operator repair' }, { status: 503 });
        }
      } catch {
        return Response.json({ error: 'transfer state requires operator repair' }, { status: 503 });
      }
      return Response.json(
        { error: 'transfer state is no longer available; create a new transfer' },
        { status: 410, headers: { 'cache-control': 'no-store', 'tus-resumable': TUS_VERSION } },
      );
    }
    return copyTusResponse(upstream);
  }
  const runtimeOffset = Number(upstream.headers.get('upload-offset'));
  const databaseOffset = Number(transfer.row.offset_bytes);
  if (!Number.isSafeInteger(runtimeOffset) || runtimeOffset < databaseOffset) {
    return Response.json({ error: 'transfer state requires operator repair' }, { status: 503 });
  }
  if (runtimeOffset > databaseOffset) {
    try {
      await sql`
        select *
        from app.advance_resumable_upload(
          ${transferId}::uuid,
          ${databaseOffset},
          ${runtimeOffset}
        )
      `;
    } catch {
      return Response.json({ error: 'transfer offset could not be reconciled' }, { status: 503 });
    }
  }
  return copyTusResponse(upstream);
};

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!validTusVersion(request)) return tusVersionError();
  if (request.headers.get('content-type') !== 'application/offset+octet-stream') {
    return Response.json({ error: 'expected application/offset+octet-stream' }, { status: 415 });
  }
  const contentLength = Number(
    request.headers.get('content-length') ?? request.headers.get('upload-chunk-length'),
  );
  const expectedOffset = Number(request.headers.get('upload-offset'));
  const checksum = request.headers.get('upload-checksum');
  if (
    !Number.isSafeInteger(contentLength)
    || contentLength < 1
    || contentLength > MAX_TRANSFER_CHUNK_BYTES
    || !Number.isSafeInteger(expectedOffset)
    || expectedOffset < 0
    || !checksum
    || !/^(?:sha1|sha256) [A-Za-z0-9+/]+={0,2}$/.test(checksum)
    || !request.body
  ) {
    return Response.json({
      error: 'a bounded chunk, current Upload-Offset, and sha1 or sha256 Upload-Checksum are required',
    }, { status: 400 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const transferId = params.transferId ?? '';
  const transfer = await authorizedTransfer(locals, request, sql, transferId);
  if (!transfer) return Response.json({ error: 'transfer not found or capability expired' }, { status: 404 });
  if (!['initiated', 'uploading'].includes(transfer.row.state)) {
    return Response.json({ error: 'transfer is not writable' }, { status: 409 });
  }
  if (expectedOffset !== Number(transfer.row.offset_bytes)) {
    return new Response(null, {
      status: 409,
      headers: {
        'cache-control': 'no-store',
        'tus-resumable': TUS_VERSION,
        'upload-offset': transfer.row.offset_bytes,
      },
    });
  }
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(locals, '/v1/transfers/' + transferId, {
      method: 'PATCH',
      headers: {
        'content-length': String(contentLength),
        'content-type': 'application/offset+octet-stream',
        'tus-resumable': TUS_VERSION,
        'x-superii-chunk-length': String(contentLength),
        'upload-checksum': checksum,
        'upload-offset': String(expectedOffset),
      },
      body: request.body,
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch {
    upstream = null;
  }
  if (!upstream) return Response.json({ error: 'transfer runtime unavailable' }, { status: 503 });
  if (!upstream.ok) return copyTusResponse(upstream);
  const newOffset = Number(upstream.headers.get('upload-offset'));
  if (
    !Number.isSafeInteger(newOffset)
    || newOffset <= expectedOffset
    || newOffset > Number(transfer.row.expected_size_bytes)
  ) {
    return Response.json({ error: 'transfer runtime returned an invalid offset' }, { status: 503 });
  }
  try {
    await sql`
      select *
      from app.advance_resumable_upload(
        ${transferId}::uuid,
        ${expectedOffset},
        ${newOffset}
      )
    `;
  } catch {
    return new Response(null, {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'retry-after': '1',
        'tus-resumable': TUS_VERSION,
        'upload-offset': String(newOffset),
      },
    });
  }
  return copyTusResponse(upstream);
};

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!validTusVersion(request)) return tusVersionError();
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const transferId = params.transferId ?? '';
  const transfer = await authorizedTransfer(locals, request, sql, transferId);
  if (!transfer) return Response.json({ error: 'transfer not found or capability expired' }, { status: 404 });
  if (transfer.row.state === 'ready') {
    return Response.json({ error: 'completed repository files must be removed from the repository workspace' }, { status: 409 });
  }
  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(locals, '/v1/transfers/' + transferId, {
      method: 'DELETE',
      headers: { 'tus-resumable': TUS_VERSION },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    upstream = null;
  }
  if (!upstream) return Response.json({ error: 'transfer runtime unavailable' }, { status: 503 });
  if (!upstream.ok) return copyTusResponse(upstream);
  await sql`
    update app.repository_uploads
    set state = 'aborted', completed_at = now(), updated_at = now()
    where id = ${transferId}::uuid and state <> 'ready'
  `.catch(() => undefined);
  return copyTusResponse(upstream);
};
