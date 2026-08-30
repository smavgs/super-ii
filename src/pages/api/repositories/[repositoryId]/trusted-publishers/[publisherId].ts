import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const repository = await managedRepository(sql, params.repositoryId ?? '', profile.profileId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  try {
    const rows = await sql`
      update app.trusted_publishers
      set enabled = false, updated_at = now()
      where id = ${params.publisherId ?? ''}::uuid
        and repository_id = ${repository.id}::uuid
      returning id
    `;
    if (!rows.length) return Response.json({ error: 'trusted publisher not found' }, { status: 404 });
    await sql`
      update app.scoped_access_tokens
      set revoked_at = coalesce(revoked_at, now())
      where trusted_publisher_id = ${params.publisherId ?? ''}::uuid
        and revoked_at is null
    `;
    return Response.json({ ok: true, disabled: true });
  } catch {
    return Response.json({ error: 'trusted publisher could not be disabled' }, { status: 409 });
  }
};
