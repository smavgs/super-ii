import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import {
  BRIDGE_IMPORT_LIMIT_BYTES,
  bridgeIdentityToken,
  detectBridgeSource,
  inspectHuggingFaceRepository,
} from '@/lib/bridge';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const jobs = await sql`
    select id, provider, source_url, status, selected_count, file_count,
           total_size_bytes, progress_bytes, cancel_requested_at, error_code,
           error_detail, started_at, completed_at, created_at, updated_at
    from app.bridge_import_jobs
    where profile_id = ${profile.profileId}::uuid
    order by created_at desc limit 20
  `;
  return Response.json({ jobs }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const allowed = await consumeRateLimit(locals, request, sql, 'bridge.import', 8, 86400);
  if (allowed !== 'allowed') {
    return Response.json({ error: allowed === 'limited' ? 'daily import limit reached' : 'safety service unavailable' }, { status: allowed === 'limited' ? 429 : 503 });
  }
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const identityId = typeof payload.identity_id === 'string' ? payload.identity_id : null;
  const selected = Array.isArray(payload.repositories) ? payload.repositories.slice(0, 50) : [];
  if (!selected.length || payload.ownership_attested !== true) {
    return Response.json({ error: 'Select repositories and confirm you are authorized to copy them' }, { status: 422 });
  }
  try {
    const credentials = await bridgeIdentityToken(locals, sql, profile.profileId, identityId);
    const inspected = [];
    let totalSize = 0;
    for (const value of selected) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_repository_selection');
      const selection = value as Record<string, unknown>;
      const source = detectBridgeSource(selection.source_url);
      if (!source || source.kind !== 'repository') throw new Error('invalid_repository_selection');
      const current = await inspectHuggingFaceRepository(source, credentials.token, credentials.identity?.scopes ?? []);
      if (typeof selection.source_revision === 'string' && selection.source_revision !== current.source_revision) {
        throw new Error('source_revision_changed');
      }
      if (current.blocked_reason) throw new Error(current.blocked_reason);
      totalSize += current.total_size_bytes;
      if (totalSize > BRIDGE_IMPORT_LIMIT_BYTES) throw new Error('import_over_25_gib');
      inspected.push(current);
    }
    const sourceUrl = typeof payload.source_url === 'string' && detectBridgeSource(payload.source_url)
      ? String(payload.source_url)
      : inspected[0].source_url;
    const rows = await sql`
      select app.create_bridge_import(
        ${profile.profileId}::uuid,
        'huggingface',
        ${credentials.identity?.id ?? null}::uuid,
        ${sourceUrl},
        ${JSON.stringify(inspected)}::jsonb,
        true
      ) as job_id
    `;
    return Response.json({
      ok: true,
      job_id: rows[0]?.job_id,
      status: 'queued',
      status_href: `/api/bridge/imports/${rows[0]?.job_id}`,
    }, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : '';
    const code = /^[a-z0-9_]{1,120}$/.test(rawCode) ? rawCode : 'import_failed';
    const status = code.includes('in_progress') ? 409 : code === 'provider_rate_limited' ? 429 : 422;
    return Response.json({ error: code.replaceAll('_', ' ') }, { status, headers: { 'cache-control': 'no-store' } });
  }
};
