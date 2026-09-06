import type { NeonQueryFunction } from '@neondatabase/serverless';
import { authorizeRepositoryRequest } from './scoped-auth';

export async function canReadSdkRepository(
  locals: App.Locals, request: Request, sql: NeonQueryFunction<false, false>,
  repository: { id: string; visibility: string; status: string },
): Promise<boolean> {
  if (repository.visibility === 'public' && repository.status === 'published') return true;
  const authorization = await authorizeRepositoryRequest(locals, request, sql, repository.id, 'repository:read');
  if (!authorization.ok) return false;
  // Token issuance is not a permanent grant after ownership or membership changes.
  const rows = await sql`select app.has_repository_permission(
    ${authorization.actor.profileId}::uuid, ${repository.id}::uuid, 'read'
  ) as allowed`;
  return rows[0]?.allowed === true;
}
