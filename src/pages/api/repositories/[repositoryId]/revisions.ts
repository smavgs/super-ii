import type { APIRoute } from 'astro';
import { managedRepository, scopedManagedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const repositoryId = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repositoryId, 'repository:commit');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, repositoryId, authorization.actor.profileId)
    : await scopedManagedRepository(sql, repositoryId);
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
        ${authorization.actor.createdBy}
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
