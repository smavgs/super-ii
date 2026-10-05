import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { managedRepository, scopedManagedRepository, textValue } from '@/lib/creator';
import { CARD_MAX_BYTES } from '@/lib/creator-card';
import { sqlClient } from '@/lib/db';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const id = params.repositoryId ?? '';
  const auth = await authorizeRepositoryRequest(locals, request, sql, id, 'repository:commit');
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const branch = new URL(request.url).searchParams.get('branch');
  const repo = auth.actor.kind === 'profile'
    ? await managedRepository(sql, id, auth.actor.profileId, branch)
    : await scopedManagedRepository(sql, id, branch);
  if (!repo) return Response.json({ error: 'repository unavailable' }, { status: 404 });
  return Response.json({ revision_id: repo.revision_id, version: repo.presentation_version,
    editable: ['draft','quarantined'].includes(repo.revision_status) },
  { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const id = params.repositoryId ?? '';
  const auth = await authorizeRepositoryRequest(locals, request, sql, id, 'repository:commit');
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const branch = new URL(request.url).searchParams.get('branch');
  const repo = auth.actor.kind === 'profile'
    ? await managedRepository(sql, id, auth.actor.profileId, branch)
    : await scopedManagedRepository(sql, id, branch);
  if (!repo) return Response.json({ error: 'repository unavailable' }, { status: 404 });
  const parsed = await readBoundedJsonObject(request, 640_000);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (body.revision_id !== repo.revision_id || !['draft','quarantined'].includes(repo.revision_status)) {
    return Response.json({ error: 'Open the current editable draft before saving.' }, { status: 409 });
  }
  const title = textValue(body.title, 201);
  const summary = textValue(body.summary, 2001);
  const card = typeof body.card_markdown === 'string' ? body.card_markdown : '';
  const bytes = new TextEncoder().encode(card);
  if (title.length < 2 || title.length > 200 || summary.length > 2000 || bytes.length > CARD_MAX_BYTES
      || !Number.isSafeInteger(body.version) || Number(body.version) < 0) {
    return Response.json({ error: 'Use a title of 2–200 characters and a card of at most 100 KB.' }, { status: 422 });
  }
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('');
  const presentation = { title, summary, task: textValue(body.task,120), library: textValue(body.library,120),
    modality: textValue(body.modality,120), card_markdown: card, ...(card ? { readme_sha256: sha } : {}) };
  try {
    // A card save must refer to the exact scanned README, including whitespace.
    // The revision and version predicates prevent stale tabs overwriting work.
    const rows = await sql`
      update app.repository_revisions rr set presentation = ${JSON.stringify(presentation)}::jsonb
      where rr.id = ${repo.revision_id}::uuid and rr.repository_id = ${id}::uuid
        and rr.status in ('draft','quarantined') and rr.presentation_version = ${Number(body.version)}
        and exists (select 1 from app.repository_branches where id = ${repo.branch_id}::uuid and head_revision_id = rr.id)
        and (${card === ''} and not exists (select 1 from app.repository_files where revision_id = rr.id and path = 'README.md')
          or exists (select 1 from app.repository_files where revision_id = rr.id and path = 'README.md'
             and sha256 = ${sha} and storage_state = 'available' and scan_status = 'clean'))
      returning presentation_version
    `;
    if (!rows.length) return Response.json({ error: 'The draft changed or README is not ready. Refresh the draft before saving again.' }, { status: 409 });
    return Response.json({ ok: true, version: rows[0].presentation_version }, { headers: { 'cache-control':'private, no-store' } });
  } catch {
    return Response.json({ error: 'Page details could not be saved.' }, { status: 503 });
  }
};
