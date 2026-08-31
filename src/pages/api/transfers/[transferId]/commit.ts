import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { runtimeFetch } from '@/lib/runtime';
import { authorizedTransfer, TUS_VERSION } from '@/lib/transfers';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (request.headers.get('tus-resumable') !== TUS_VERSION) {
    return Response.json(
      { error: 'unsupported tus version' },
      { status: 412, headers: { 'cache-control': 'no-store', 'tus-version': TUS_VERSION } },
    );
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const transferId = params.transferId ?? '';
  const transfer = await authorizedTransfer(locals, request, sql, transferId);
  if (!transfer) {
    return Response.json({ error: 'transfer not found or capability expired' }, { status: 404 });
  }
  if (transfer.row.state === 'ready') {
    return Response.json(transfer.row.receipt, {
      headers: { 'cache-control': 'no-store', 'tus-resumable': TUS_VERSION },
    });
  }
  if (
    !['uploaded', 'scanning'].includes(transfer.row.state)
    || Number(transfer.row.offset_bytes) !== Number(transfer.row.expected_size_bytes)
  ) {
    return Response.json({ error: 'all bytes must be uploaded before commit' }, { status: 409 });
  }

  let upstream: Response | null;
  try {
    upstream = await runtimeFetch(locals, `/v1/transfers/${transferId}/commit`, {
      method: 'POST',
      headers: { 'tus-resumable': TUS_VERSION },
      signal: AbortSignal.timeout(20 * 60_000),
    });
  } catch {
    upstream = null;
  }
  if (!upstream) {
    return Response.json({ error: 'transfer scanning runtime unavailable' }, { status: 503 });
  }
  const body = await upstream.text();
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'tus-resumable': TUS_VERSION,
  });
  return new Response(body, { status: upstream.status, headers });
};
