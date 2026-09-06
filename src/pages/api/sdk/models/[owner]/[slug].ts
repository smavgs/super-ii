import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { canReadSdkRepository } from '@/lib/sdk-access';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const requested = new URL(request.url).searchParams.get('revision');
  if (requested && !/^[a-f0-9]{64}$/.test(requested)) {
    return Response.json({ error: 'revision must be a full immutable commit SHA-256' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select id, visibility, status, owner_handle, slug, title, license, provenance, latest_revision_id
      from app.repositories where kind = 'model' and lower(owner_handle) = lower(${params.owner ?? ''})
        and lower(slug) = lower(${params.slug ?? ''}) limit 1
    `;
    const repository = rows[0];
    if (!repository || !await canReadSdkRepository(locals, request, sql, {
      id: String(repository.id), visibility: String(repository.visibility), status: String(repository.status),
    })) return Response.json({ error: 'repository unavailable' }, { status: 404 });
    const releases = await sql`
      select id, commit_sha, manifest_sha256, total_size_bytes, sequence, published_at
      from app.repository_revisions where repository_id = ${String(repository.id)}::uuid
        and status = 'published'
        and ((${requested}::text is null and id = ${String(repository.latest_revision_id)}::uuid)
          or commit_sha = ${requested}) limit 1
    `;
    const revision = releases[0];
    if (!revision) return Response.json({ error: 'published revision unavailable' }, { status: 404 });
    const [files, compatibility, decisions] = await Promise.all([
      sql`select id, path, sha256, size_bytes, mime_type from app.repository_files
          where revision_id = ${String(revision.id)}::uuid
            and storage_state = 'available' and scan_status = 'clean' order by path`,
      sql`select * from app.repository_compatibility where revision_id = ${String(revision.id)}::uuid limit 1`,
      sql`select d.payload, d.signature, d.key_id, d.policy_sha256, k.public_key
          from app.publication_decisions d join app.publication_keys k on k.id = d.key_id
          where d.revision_id = ${String(revision.id)}::uuid and d.outcome = 'passed'
          order by d.created_at desc limit 1`,
    ]);
    const origin = new URL(request.url).origin;
    return Response.json({
      schema: 'https://superii.site/schemas/sdk-manifest-v1.json',
      repository: { id: repository.id, kind: 'model', owner: repository.owner_handle,
        slug: repository.slug, title: repository.title, license: repository.license,
        visibility: repository.visibility },
      revision, provenance: repository.provenance, compatibility: compatibility[0] ?? null,
      publication: decisions[0] ?? null,
      files: files.map(({ id, ...file }) => ({ ...file,
        download_url: `${origin}/api/repositories/${repository.id}/files/${id}`,
      })),
    }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return Response.json({ error: 'repository metadata unavailable' }, { status: 503 });
  }
};
