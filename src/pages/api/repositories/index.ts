import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { repositorySlugPattern, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const kinds = new Set(['model', 'dataset', 'space']);

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      select distinct r.id, r.kind, r.owner_handle, r.slug, r.title, r.summary,
             r.owner_organization_id, r.status, r.updated_at,
             rr.id as revision_id, rr.status as revision_status, rr.sequence
      from app.repositories r
      left join app.organization_members m on m.organization_id = r.owner_organization_id
      left join app.repository_branches b on b.repository_id = r.id and b.is_default
      left join app.repository_revisions rr on rr.id = b.head_revision_id
      where r.owner_profile_id = ${profile.profileId}::uuid
         or (m.profile_id = ${profile.profileId}::uuid and m.role in ('owner', 'admin', 'maintainer'))
      order by r.updated_at desc
      limit 100
    `;
    return Response.json({ repositories: rows }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'repositories unavailable' }, { status: 503 });
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'repository.create', 20, 86400);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'repository creation limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503 },
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const kind = textValue(payload.kind, 20);
  const slug = textValue(payload.slug, 96).toLowerCase();
  const title = textValue(payload.title, 200);
  const summary = textValue(payload.summary, 2000);
  const organizationId = textValue(payload.organization_id, 36) || null;
  const license = textValue(payload.license, 120);
  const task = textValue(payload.task, 120);
  const library = textValue(payload.library, 120);
  const modality = textValue(payload.modality, 120);
  const cardMarkdown = textValue(payload.card_markdown, 100000);
  const sourceUrls = Array.isArray(payload.source_urls)
    ? payload.source_urls.map((value) => textValue(value, 2048)).filter(Boolean).slice(0, 50)
    : [];
  if (!kinds.has(kind) || !repositorySlugPattern.test(slug) || title.length < 2 || summary.length < 10) {
    return Response.json({ error: 'valid repository kind, slug, title, and summary are required' }, { status: 422 });
  }
  if (sourceUrls.some((raw) => {
    try { return new URL(raw).protocol !== 'https:'; } catch { return true; }
  })) {
    return Response.json({ error: 'provenance source URLs must use HTTPS' }, { status: 422 });
  }

  try {
    const rows = await sql`
      select * from app.create_repository_with_revision(
        ${profile.profileId}::uuid,
        ${organizationId}::uuid,
        ${kind}::repository_kind,
        ${slug},
        ${title},
        ${summary},
        ${license || null},
        ${task || null},
        ${library || null},
        ${modality || null},
        ${cardMarkdown},
        ${JSON.stringify({ sources: sourceUrls })}::jsonb
      )
    `;
    const created = rows[0];
    if (!created?.repository_id) throw new Error('missing repository id');
    const ownerRows = await sql`
      select owner_handle from app.repositories where id = ${String(created.repository_id)}::uuid
    `;
    const owner = String(ownerRows[0]?.owner_handle ?? '');
    const prefix = kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
    return Response.json({
      ok: true,
      repository_id: created.repository_id,
      revision_id: created.revision_id,
      branch_id: created.branch_id,
      edit_href: `/repositories/${created.repository_id}/edit`,
      public_href: `/${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'repository slug is unavailable or the selected owner is invalid' }, { status: 409 });
  }
};
