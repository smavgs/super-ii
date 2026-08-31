import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

type BridgeContext =
  | { response: Response }
  | { sql: NonNullable<ReturnType<typeof sqlClient>>; profile: Awaited<ReturnType<typeof ensureAuthenticatedProfile>> & {} };

async function context(locals: App.Locals, jobId: string): Promise<BridgeContext> {
  const sql = sqlClient(locals);
  if (!sql) return { response: Response.json({ error: 'database unavailable' }, { status: 503 }) } as const;
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return { response: Response.json({ error: 'authentication required' }, { status: 401 }) } as const;
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) return { response: Response.json({ error: 'invalid import' }, { status: 404 }) } as const;
  return { sql, profile } as const;
}

export const GET: APIRoute = async ({ locals, params }) => {
  const jobId = params.jobId ?? '';
  const result = await context(locals, jobId);
  if ('response' in result) return result.response;
  const jobs = await result.sql`
    select id, provider, source_url, status, selected_count, file_count,
           total_size_bytes, progress_bytes, cancel_requested_at, error_code,
           error_detail, started_at, completed_at, created_at, updated_at
    from app.bridge_import_jobs
    where id = ${jobId}::uuid and profile_id = ${result.profile.profileId}::uuid
    limit 1
  `;
  if (!jobs[0]) return Response.json({ error: 'import not found' }, { status: 404 });
  const items = await result.sql`
    select id, repository_id, revision_id, provider_repo_id, source_revision,
           source_url, kind, title, license, file_count, total_size_bytes,
           largest_file_bytes, status, blocked_reason, progress_bytes,
           error_code, error_detail, imported_manifest_sha256, started_at,
           completed_at, updated_at
    from app.bridge_import_items
    where job_id = ${jobId}::uuid order by created_at
  `;
  return Response.json({ job: jobs[0], items }, { headers: { 'cache-control': 'private, no-store' } });
};

export const DELETE: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const jobId = params.jobId ?? '';
  const result = await context(locals, jobId);
  if ('response' in result) return result.response;
  const rows = await result.sql`
    select app.request_bridge_import_cancel(${jobId}::uuid, ${result.profile.profileId}::uuid) as cancelled
  `;
  if (rows[0]?.cancelled !== true) return Response.json({ error: 'active import not found' }, { status: 404 });
  return Response.json({ ok: true, status: 'cancel_requested' }, { headers: { 'cache-control': 'no-store' } });
};
