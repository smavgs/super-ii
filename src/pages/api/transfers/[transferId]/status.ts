import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { runtimeFetch } from '@/lib/runtime';
import { authorizedTransfer, TUS_VERSION } from '@/lib/transfers';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const transferId = params.transferId ?? '';
  const transfer = await authorizedTransfer(locals, request, sql, transferId);
  if (!transfer) {
    return Response.json({ error: 'transfer not found or capability expired' }, { status: 404 });
  }
  let runtimeState: Record<string, unknown> | null = null;
  try {
    const upstream = await runtimeFetch(locals, `/v1/transfers/${transferId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream?.ok) runtimeState = await upstream.json() as Record<string, unknown>;
  } catch {
    runtimeState = null;
  }
  return Response.json({
    transfer_id: transfer.row.id,
    state: transfer.row.state,
    offset: Number(transfer.row.offset_bytes),
    length: Number(transfer.row.expected_size_bytes),
    sha256: transfer.row.actual_sha256 ?? transfer.row.expected_sha256,
    repository_file_id: transfer.row.repository_file_id,
    receipt: transfer.row.receipt,
    error_code: transfer.row.error_code,
    runtime_state: runtimeState?.status ?? null,
  }, { headers: { 'cache-control': 'no-store', 'tus-resumable': TUS_VERSION } });
};
