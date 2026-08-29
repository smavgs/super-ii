import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const refPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9])?$/;

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = await managedRepository(sql, params.repositoryId ?? '', profile.profileId, branchId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const name = textValue(payload.name, 128);
  const revisionId = textValue(payload.revision_id, 36) || repository.revision_id;
  if (!refPattern.test(name)) return Response.json({ error: 'invalid tag name' }, { status: 422 });
  try {
    const rows = await sql`
      insert into app.repository_tags (repository_id, revision_id, name, created_by)
      select ${repository.id}::uuid, rr.id, ${name}, ${profile.profileId}
      from app.repository_revisions rr
      where rr.id = ${revisionId}::uuid and rr.repository_id = ${repository.id}::uuid and rr.status = 'published'
      returning id, name
    `;
    if (!rows.length) return Response.json({ error: 'only published revisions can be tagged' }, { status: 409 });
    return Response.json({ ok: true, tag: rows[0] }, { status: 201 });
  } catch {
    return Response.json({ error: 'tag already exists or could not be created' }, { status: 409 });
  }
};
