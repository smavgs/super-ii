import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { managedRepository, scopedManagedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { authorizeRepositoryRequest } from '@/lib/scoped-auth';
import { canReadSdkRepository } from '@/lib/sdk-access';
import { canonical, checksum } from '@/lib/engineering-recipes';
import { recipeInputRequest } from '@/lib/recipe-access';
import { sameOrigin } from '@/lib/auth';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.object({ kind: z.enum(['model', 'dataset']), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/), revision: hash, manifest_sha256: hash, files: z.array(z.string().max(1024)).max(20000) }).strict();
const declaration = z.object({
  recipe: z.object({ schema: z.literal('https://superii.site/schemas/superii-recipe-v1.json'), recipe_sha256: hash, outcome: z.literal('sft'), inputs: z.object({ generator: reference, embedding: z.null(), dataset: reference }) }).catchall(z.unknown()),
  run: z.object({ schema: z.literal('https://superii.site/schemas/superii-run-v1.json'), run_id: z.uuid(), recipe_sha256: hash, stage: z.literal('train'), status: z.literal('completed'), evidence: z.object({ classification: z.literal('reported'), independent_verification: z.literal(false) }).strict(), artifacts: z.array(z.object({ path: z.string().max(1024), sha256: hash, size_bytes: z.number().int().nonnegative() }).strict()).min(1).max(2000) }).catchall(z.unknown()),
}).strict();

async function contextFor(context: Parameters<APIRoute>[0], scope: 'repository:read' | 'repository:commit') {
  const sql = sqlClient(context.locals);
  if (!sql) return { error: 'database unavailable', status: 503 };
  const id = context.params.repositoryId ?? '';
  const authorization = await authorizeRepositoryRequest(context.locals, context.request, sql, id, scope);
  if (!authorization.ok) return authorization;
  if (scope === 'repository:commit' && authorization.actor.kind === 'profile' && !sameOrigin(context.request)) return { error: 'invalid origin', status: 403 };
  const branchId = new URL(context.request.url).searchParams.get('branch');
  const repository = authorization.actor.kind === 'profile'
    ? await managedRepository(sql, id, authorization.actor.profileId, branchId)
    : await scopedManagedRepository(sql, id, branchId);
  if (!repository) return { error: 'repository unavailable', status: 404 };
  return { sql, repository, actor: authorization.actor };
}

export const GET: APIRoute = async (context) => {
  const access = await contextFor(context, 'repository:read');
  if ('error' in access) return Response.json({ error: access.error }, { status: access.status });
  const files = await access.sql`select path, sha256, size_bytes from app.repository_files where revision_id = ${access.repository.revision_id}::uuid and storage_state = 'available' and scan_status = 'clean' order by path`;
  return Response.json({ repository_id: access.repository.id, revision_id: access.repository.revision_id, branch_id: access.repository.branch_id, status: access.repository.revision_status, files }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: APIRoute = async (context) => {
  const access = await contextFor(context, 'repository:commit');
  if ('error' in access) return Response.json({ error: access.error }, { status: access.status });
  const body = await readBoundedJsonObject(context.request, 1024 * 1024);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = declaration.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: 'Supply an SFT recipe and completed reported training record' }, { status: 422 });
  const { recipe, run } = parsed.data;
  const { recipe_sha256: expected, ...unsigned } = recipe;
  if (checksum(canonical(unsigned)) !== expected || run.recipe_sha256 !== expected || recipe.inputs.generator.kind !== 'model' || recipe.inputs.dataset.kind !== 'dataset') return Response.json({ error: 'Recipe and run references differ' }, { status: 422 });
  if (!['draft', 'quarantined'].includes(access.repository.revision_status) || access.repository.kind !== 'model') return Response.json({ error: 'Use an editable model revision' }, { status: 409 });
  try {
    const files = await access.sql`select path, sha256, size_bytes from app.repository_files where revision_id = ${access.repository.revision_id}::uuid and storage_state = 'available' and scan_status = 'clean'`;
    const required = [...run.artifacts, { path: 'superii-recipe.json', sha256: checksum(canonical(recipe) + '\n') }, { path: 'superii-run.json', sha256: checksum(canonical(run) + '\n') }];
    if (!required.every(item => files.some(file => file.path === item.path && file.sha256 === item.sha256 && (!('size_bytes' in item) || Number(file.size_bytes) === item.size_bytes)))) return Response.json({ error: 'Upload the exact recipe, run record and all reported artifacts first' }, { status: 422 });
    if (!run.artifacts.some(file => file.path === 'adapter_model.safetensors')) return Response.json({ error: 'The recipe needs an adapter output' }, { status: 422 });
    const edges = [];
    for (const [role, type] of [['generator', 'fine-tuned-from'], ['dataset', 'trained-on']] as const) {
      const input = recipe.inputs[role];
      const [owner, slug] = input.repository.split('/');
      const rows = await access.sql`select r.id, r.status, r.visibility, rr.id as revision_id from app.repositories r join app.repository_revisions rr on rr.repository_id = r.id where lower(r.owner_handle) = lower(${owner}) and lower(r.slug) = lower(${slug}) and r.kind = ${input.kind} and rr.commit_sha = ${input.revision} and rr.manifest_sha256 = ${input.manifest_sha256} and rr.status = 'published' limit 1`;
      const target = rows[0];
      if (!target || target.id === access.repository.id || !await canReadSdkRepository(context.locals, recipeInputRequest(context.request, role), access.sql, { id: String(target.id), visibility: String(target.visibility), status: String(target.status) })) return Response.json({ error: 'A lineage input is unavailable or inaccessible' }, { status: 404 });
      edges.push({ type, id: String(target.id), revision: String(target.revision_id) });
    }
    await access.sql.transaction(edges.map(edge => access.sql`insert into app.repository_relationships (source_repository_id, target_repository_id, relationship_type, source_revision_id, target_revision_id, metadata, created_by) select ${access.repository.id}::uuid, ${edge.id}::uuid, ${edge.type}, ${access.repository.revision_id}::uuid, ${edge.revision}::uuid, ${JSON.stringify({ recipe_sha256: expected, run_id: run.run_id, evidence: 'reported', adaptation: 'lora' })}::jsonb, ${access.actor.createdBy} where exists (select 1 from app.repository_revisions where id = ${access.repository.revision_id}::uuid and status in ('draft','quarantined')) on conflict (source_repository_id, target_repository_id, relationship_type) do update set source_revision_id = excluded.source_revision_id, target_revision_id = excluded.target_revision_id, metadata = excluded.metadata, created_by = excluded.created_by returning id`));
    return Response.json({ ok: true, recipe_sha256: expected, run_id: run.run_id, evidence: 'reported', publication_policy: 'unchanged' });
  } catch { return Response.json({ error: 'Recipe lineage could not be attached' }, { status: 503 }); }
};
