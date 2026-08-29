import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const branchPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9])?$/;

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const repository = await managedRepository(sql, params.repositoryId ?? '', profile.profileId);
  if (!repository) return Response.json({ error: 'repository not found or access denied' }, { status: 404 });
  try {
    const rows = await sql`
      select b.id, b.name, b.is_default, b.updated_at,
             rr.id as revision_id, rr.sequence, rr.status, rr.commit_sha
      from app.repository_branches b
      left join app.repository_revisions rr on rr.id = b.head_revision_id
      where b.repository_id = ${repository.id}::uuid
      order by b.is_default desc, b.name
    `;
    return Response.json({ branches: rows }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'branches unavailable' }, { status: 503 });
  }
};

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
  if (!branchPattern.test(name)) return Response.json({ error: 'invalid branch name' }, { status: 422 });
  try {
    const rows = await sql`
      insert into app.repository_branches (
        repository_id, name, head_revision_id, is_default, created_by
      ) values (
        ${repository.id}::uuid, ${name}, ${repository.revision_id}::uuid, false, ${profile.profileId}
      ) returning id, name, head_revision_id
    `;
    return Response.json({
      ok: true,
      branch: rows[0],
      edit_href: `/repositories/${repository.id}/edit?branch=${encodeURIComponent(String(rows[0].id))}`,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'branch already exists or could not be created' }, { status: 409 });
  }
};
