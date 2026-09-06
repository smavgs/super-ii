import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { managedRepository, scopedManagedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const id = params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(locals, request, sql, id, 'repository:commit');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const branchId = new URL(request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, id, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, id, branchId);
  if (!repository) return Response.json({ error: 'repository unavailable' }, { status: 404 });
  if (!['draft', 'quarantined'].includes(repository.revision_status)) {
    return Response.json({ error: 'Create an editable revision before changing publication declarations' }, { status: 409 });
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  const license = textValue(body.license, 120).toLowerCase();
  const basis = textValue(body.basis, 40);
  const source = textValue(body.source_url, 2048);
  if (!license || body.confirmed !== true || !['original', 'permission', 'licensed-redistribution'].includes(basis)) {
    return Response.json({ error: 'Provide the license and confirm the basis for your right to publish' }, { status: 422 });
  }
  if (basis !== 'original') {
    try {
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch { return Response.json({ error: 'Provide an HTTPS source URL' }, { status: 422 }); }
  }
  try {
    const declaration = { confirmed: true, basis, source_url: source || null,
      declared_by: authorization.actor.createdBy, declared_at: new Date().toISOString() };
    const rows = await sql`
      update app.repositories set license = ${license}, provenance = provenance ||
        ${JSON.stringify({ rights_declaration: declaration })}::jsonb
      where id = ${id}::uuid and exists (
        select 1 from app.repository_revisions where id = ${repository.revision_id}::uuid
          and status in ('draft', 'quarantined')
      ) returning id
    `;
    if (!rows.length) return Response.json({ error: 'Revision changed; refresh before retrying' }, { status: 409 });
    return Response.json({ ok: true, declaration });
  } catch { return Response.json({ error: 'Publication metadata could not be saved' }, { status: 503 }); }
};
