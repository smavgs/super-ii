import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const repository = await managedRepository(sql, params.repositoryId ?? '', profile.profileId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const branchId = textValue(payload.branch_id, 36) || repository.branch_id;
  const message = textValue(payload.message, 2000) || 'Update repository';
  try {
    const rows = await sql`
      select * from app.create_repository_commit(
        ${repository.id}::uuid,
        ${branchId}::uuid,
        ${message},
        ${profile.profileId}
      )
    `;
    return Response.json({
      ok: true,
      revision: rows[0],
      edit_href: `/repositories/${repository.id}/edit?branch=${encodeURIComponent(branchId)}`,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'finish or submit the current editable revision before creating another commit' }, { status: 409 });
  }
};
