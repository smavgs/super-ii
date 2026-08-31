import { sqlClient } from './db';
import type { RepositoryKind } from './catalog';

export type RepositoryFileView = {
  id: string;
  path: string;
  size_bytes: string;
  mime_type: string;
  sha256: string;
  created_at: string;
};

export type RepositoryAnalysisView = {
  analysis_type: string;
  status: string;
  result: Record<string, unknown>;
  tool_versions: Record<string, string>;
  completed_at: string | null;
};

export type RepositoryCompatibilityView = {
  architecture: string | null;
  parameter_count: string | null;
  quantization: string | null;
  tensor_format: string | null;
  model_size_bytes: string;
  minimum_ram_bytes: string;
  minimum_vram_bytes: string;
  cpu_compatible: boolean | null;
  cuda_compatible: boolean | null;
  rocm_compatible: boolean | null;
  metal_compatible: boolean | null;
  mlx_compatible: boolean | null;
  llama_cpp_compatible: boolean | null;
  browser_compatible: boolean | null;
  confidence: 'declared' | 'derived' | 'verified';
  evidence: Record<string, unknown>;
};

export type RepositoryBundle = {
  id: string;
  kind: RepositoryKind;
  owner_handle: string;
  slug: string;
  title: string;
  summary: string;
  license: string | null;
  task: string | null;
  library: string | null;
  modality: string | null;
  card_markdown: string;
  provenance: Record<string, unknown>;
  total_size_bytes: string;
  updated_at: string;
  revision_id: string;
  revision_sequence: number;
  manifest_sha256: string;
  published_at: string;
  commit_sha: string | null;
  manifest: Array<Record<string, unknown>>;
  files: RepositoryFileView[];
  analyses: RepositoryAnalysisView[];
  compatibility: RepositoryCompatibilityView | null;
  releases: Array<{ id: string; name: string; slug: string; notes: string; created_at: string }>;
  tags: Array<{ id: string; name: string; created_at: string }>;
  versions: Array<{
    id: string;
    sequence: number;
    message: string;
    manifest_sha256: string;
    file_count: number;
    total_size_bytes: string;
    commit_sha: string | null;
    branch_name: string | null;
    published_at: string;
  }>;
  branches: Array<{
    id: string;
    name: string;
    is_default: boolean;
    revision_id: string | null;
    sequence: number | null;
    commit_sha: string | null;
  }>;
  discussions: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    author: string;
    created_at: string;
    comment_count: number;
    reactions: Record<string, number>;
    comments: Array<{
      id: string;
      body: string;
      author: string;
      created_at: string;
      reactions: Record<string, number>;
    }>;
  }>;
  likes_count: number;
  watchers_count: number;
  downloads_count: number;
  relationships: Array<{
    id: string;
    relationship_type: string;
    direction: 'outgoing' | 'incoming';
    related_kind: RepositoryKind;
    related_owner: string;
    related_slug: string;
    related_title: string;
    related_compatibility: RepositoryCompatibilityView | null;
    evidence_url: string | null;
  }>;
  related: Array<{
    kind: RepositoryKind;
    owner_handle: string;
    slug: string;
    title: string;
    summary: string;
    match_score: number;
  }>;
  agent_traces: Array<{
    trace_id: string;
    agent_name: string;
    tool_name: string | null;
    status: string;
    duration_ms: number | null;
    input_sha256: string | null;
    output_sha256: string | null;
    metadata: Record<string, unknown>;
    occurred_at: string;
  }>;
};

export async function getPublicRepository(
  locals: App.Locals,
  kind: RepositoryKind,
  owner: string,
  slug: string,
): Promise<{ state: 'ok' | 'unconfigured' | 'error' | 'not_found'; repository: RepositoryBundle | null }> {
  const sql = sqlClient(locals);
  if (!sql) return { state: 'unconfigured', repository: null };
  try {
    const rows = await sql`
      select
        r.id,
        r.kind,
        r.owner_handle,
        r.slug,
        r.title,
        r.summary,
        r.license,
        r.task,
        r.library,
        r.modality,
        r.card_markdown,
        r.provenance,
        r.total_size_bytes,
        r.updated_at,
        rr.id as revision_id,
        rr.sequence as revision_sequence,
        rr.manifest_sha256,
        rr.commit_sha,
        rr.manifest,
        rr.published_at,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id,
            'path', f.path,
            'size_bytes', f.size_bytes,
            'mime_type', f.mime_type,
            'sha256', f.sha256,
            'created_at', f.created_at
          ) order by f.path)
          from app.repository_files f
          where f.revision_id = rr.id
            and f.storage_state = 'available'
            and f.scan_status = 'clean'
        ), '[]'::jsonb) as files,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'analysis_type', a.analysis_type,
            'status', a.status,
            'result', a.result,
            'tool_versions', a.tool_versions,
            'completed_at', a.completed_at
          ) order by a.analysis_type)
          from app.repository_revision_analyses a
          where a.revision_id = rr.id and a.status = 'passed'
        ), '[]'::jsonb) as analyses,
        (
          select jsonb_build_object(
            'architecture', compatibility.architecture,
            'parameter_count', compatibility.parameter_count,
            'quantization', compatibility.quantization,
            'tensor_format', compatibility.tensor_format,
            'model_size_bytes', compatibility.model_size_bytes,
            'minimum_ram_bytes', compatibility.minimum_ram_bytes,
            'minimum_vram_bytes', compatibility.minimum_vram_bytes,
            'cpu_compatible', compatibility.cpu_compatible,
            'cuda_compatible', compatibility.cuda_compatible,
            'rocm_compatible', compatibility.rocm_compatible,
            'metal_compatible', compatibility.metal_compatible,
            'mlx_compatible', compatibility.mlx_compatible,
            'llama_cpp_compatible', compatibility.llama_cpp_compatible,
            'browser_compatible', compatibility.browser_compatible,
            'confidence', compatibility.confidence,
            'evidence', compatibility.evidence
          )
          from app.repository_compatibility compatibility
          where compatibility.revision_id = rr.id
        ) as compatibility,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', release.id,
            'name', release.name,
            'slug', release.slug,
            'notes', release.notes,
            'created_at', release.created_at
          ) order by release.created_at desc)
          from app.repository_releases release
          where release.repository_id = r.id and release.revision_id = rr.id
        ), '[]'::jsonb) as releases,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', tag.id,
            'name', tag.name,
            'created_at', tag.created_at
          ) order by tag.name)
          from app.repository_tags tag
          where tag.repository_id = r.id and tag.revision_id = rr.id
        ), '[]'::jsonb) as tags,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', version.id,
            'sequence', version.sequence,
            'message', version.message,
            'manifest_sha256', version.manifest_sha256,
            'file_count', version.file_count,
            'total_size_bytes', version.total_size_bytes,
            'commit_sha', version.commit_sha,
            'branch_name', branch.name,
            'published_at', version.published_at
          ) order by version.sequence desc)
          from app.repository_revisions version
          left join app.repository_branches branch on branch.id = version.branch_id
          where version.repository_id = r.id and version.status = 'published'
        ), '[]'::jsonb) as versions,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', branch.id,
            'name', branch.name,
            'is_default', branch.is_default,
            'revision_id', head.id,
            'sequence', head.sequence,
            'commit_sha', head.commit_sha
          ) order by branch.is_default desc, branch.name)
          from app.repository_branches branch
          left join app.repository_revisions head on head.id = branch.head_revision_id
          where branch.repository_id = r.id
        ), '[]'::jsonb) as branches,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', d.id,
            'title', d.title,
            'body', d.body,
            'status', d.status,
            'author', p.handle,
            'created_at', d.created_at,
            'comment_count', (select count(*) from app.discussion_comments c where c.discussion_id = d.id),
            'reactions', (
              select coalesce(jsonb_object_agg(grouped.reaction, grouped.reaction_count), '{}'::jsonb)
              from (
                select reaction, count(*)::integer as reaction_count
                from app.reactions
                where target_type = 'discussion' and target_id = d.id
                group by reaction
              ) grouped
            ),
            'comments', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id,
                'body', c.body,
                'author', cp.handle,
                'created_at', c.created_at,
                'reactions', (
                  select coalesce(jsonb_object_agg(grouped.reaction, grouped.reaction_count), '{}'::jsonb)
                  from (
                    select reaction, count(*)::integer as reaction_count
                    from app.reactions
                    where target_type = 'comment' and target_id = c.id
                    group by reaction
                  ) grouped
                )
              ) order by c.created_at), '[]'::jsonb)
              from app.discussion_comments c
              join app.profiles cp on cp.id = c.author_profile_id
              where c.discussion_id = d.id
            )
          ) order by d.updated_at desc)
          from app.discussions d
          join app.profiles p on p.id = d.author_profile_id
          where d.repository_id = r.id
          limit 20
        ), '[]'::jsonb) as discussions,
        (select count(*)::integer from app.likes l where l.repository_id = r.id) as likes_count,
        (select count(*)::integer from app.repository_watchers w where w.repository_id = r.id) as watchers_count,
        (select count(*)::integer from app.repository_downloads download where download.repository_id = r.id) as downloads_count,
        coalesce((
          select jsonb_agg(relationship order by relationship->>'relationship_type')
          from (
            select jsonb_build_object(
              'id', rel.id,
              'relationship_type', rel.relationship_type,
              'direction', 'outgoing',
              'related_kind', related.kind,
              'related_owner', related.owner_handle,
              'related_slug', related.slug,
              'related_title', related.title,
              'related_compatibility', (
                select jsonb_build_object(
                  'architecture', related_compatibility.architecture,
                  'parameter_count', related_compatibility.parameter_count,
                  'quantization', related_compatibility.quantization,
                  'tensor_format', related_compatibility.tensor_format,
                  'model_size_bytes', related_compatibility.model_size_bytes,
                  'minimum_ram_bytes', related_compatibility.minimum_ram_bytes,
                  'minimum_vram_bytes', related_compatibility.minimum_vram_bytes,
                  'cpu_compatible', related_compatibility.cpu_compatible,
                  'cuda_compatible', related_compatibility.cuda_compatible,
                  'rocm_compatible', related_compatibility.rocm_compatible,
                  'metal_compatible', related_compatibility.metal_compatible,
                  'mlx_compatible', related_compatibility.mlx_compatible,
                  'llama_cpp_compatible', related_compatibility.llama_cpp_compatible,
                  'browser_compatible', related_compatibility.browser_compatible,
                  'confidence', related_compatibility.confidence,
                  'evidence', related_compatibility.evidence
                )
                from app.repository_compatibility related_compatibility
                where related_compatibility.revision_id = related.latest_revision_id
              ),
              'evidence_url', rel.evidence_url
            ) as relationship
            from app.repository_relationships rel
            join app.repositories related on related.id = rel.target_repository_id
            where rel.source_repository_id = r.id
              and related.visibility = 'public' and related.status = 'published'
            union all
            select jsonb_build_object(
              'id', rel.id,
              'relationship_type', rel.relationship_type,
              'direction', 'incoming',
              'related_kind', related.kind,
              'related_owner', related.owner_handle,
              'related_slug', related.slug,
              'related_title', related.title,
              'related_compatibility', (
                select jsonb_build_object(
                  'architecture', related_compatibility.architecture,
                  'parameter_count', related_compatibility.parameter_count,
                  'quantization', related_compatibility.quantization,
                  'tensor_format', related_compatibility.tensor_format,
                  'model_size_bytes', related_compatibility.model_size_bytes,
                  'minimum_ram_bytes', related_compatibility.minimum_ram_bytes,
                  'minimum_vram_bytes', related_compatibility.minimum_vram_bytes,
                  'cpu_compatible', related_compatibility.cpu_compatible,
                  'cuda_compatible', related_compatibility.cuda_compatible,
                  'rocm_compatible', related_compatibility.rocm_compatible,
                  'metal_compatible', related_compatibility.metal_compatible,
                  'mlx_compatible', related_compatibility.mlx_compatible,
                  'llama_cpp_compatible', related_compatibility.llama_cpp_compatible,
                  'browser_compatible', related_compatibility.browser_compatible,
                  'confidence', related_compatibility.confidence,
                  'evidence', related_compatibility.evidence
                )
                from app.repository_compatibility related_compatibility
                where related_compatibility.revision_id = related.latest_revision_id
              ),
              'evidence_url', rel.evidence_url
            ) as relationship
            from app.repository_relationships rel
            join app.repositories related on related.id = rel.source_repository_id
            where rel.target_repository_id = r.id
              and related.visibility = 'public' and related.status = 'published'
          ) lineage
        ), '[]'::jsonb) as relationships,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', related.kind,
            'owner_handle', related.owner_handle,
            'slug', related.slug,
            'title', related.title,
            'summary', related.summary,
            'match_score', related.match_score
          ) order by related.match_score desc, related.updated_at desc)
          from (
            select candidate.*,
              (case when candidate.task is not null and r.task is not null and lower(candidate.task) = lower(r.task) then 4 else 0 end
               + case when candidate.library is not null and r.library is not null and lower(candidate.library) = lower(r.library) then 3 else 0 end
               + case when candidate.modality is not null and r.modality is not null and lower(candidate.modality) = lower(r.modality) then 2 else 0 end
               + case when candidate.owner_handle = r.owner_handle then 1 else 0 end) as match_score
            from app.repositories candidate
            where candidate.id <> r.id
              and candidate.visibility = 'public' and candidate.status = 'published'
              and (
                (candidate.task is not null and r.task is not null and lower(candidate.task) = lower(r.task))
                or (candidate.library is not null and r.library is not null and lower(candidate.library) = lower(r.library))
                or (candidate.modality is not null and r.modality is not null and lower(candidate.modality) = lower(r.modality))
                or candidate.owner_handle = r.owner_handle
              )
            order by match_score desc, candidate.updated_at desc
            limit 6
          ) related
        ), '[]'::jsonb) as related,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'trace_id', trace.trace_id,
            'agent_name', trace.agent_name,
            'tool_name', trace.tool_name,
            'status', trace.status,
            'duration_ms', trace.duration_ms,
            'input_sha256', trace.input_sha256,
            'output_sha256', trace.output_sha256,
            'metadata', trace.metadata,
            'occurred_at', trace.occurred_at
          ) order by trace.occurred_at desc)
          from app.agent_traces trace
          where trace.repository_id = r.id and trace.is_public
        ), '[]'::jsonb) as agent_traces
      from app.repositories r
      join app.repository_revisions rr on rr.id = r.latest_revision_id
      where r.kind = ${kind}::repository_kind
        and lower(r.owner_handle) = lower(${owner})
        and lower(r.slug) = lower(${slug})
        and r.visibility = 'public'
        and r.status = 'published'
        and rr.status = 'published'
      limit 1
    `;
    if (!rows.length) return { state: 'not_found', repository: null };
    return { state: 'ok', repository: rows[0] as RepositoryBundle };
  } catch {
    return { state: 'error', repository: null };
  }
}

export { kindPath } from './repository-path';
