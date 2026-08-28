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
  total_size_bytes: string;
  updated_at: string;
  revision_id: string;
  revision_sequence: number;
  manifest_sha256: string;
  published_at: string;
  files: RepositoryFileView[];
  analyses: RepositoryAnalysisView[];
  releases: Array<{ id: string; name: string; slug: string; notes: string; created_at: string }>;
  tags: Array<{ id: string; name: string; created_at: string }>;
  versions: Array<{
    id: string;
    sequence: number;
    message: string;
    manifest_sha256: string;
    file_count: number;
    total_size_bytes: string;
    published_at: string;
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
  relationships: Array<{
    id: string;
    relationship_type: string;
    direction: 'outgoing' | 'incoming';
    related_kind: RepositoryKind;
    related_owner: string;
    related_slug: string;
    related_title: string;
    evidence_url: string | null;
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
        r.total_size_bytes,
        r.updated_at,
        rr.id as revision_id,
        rr.sequence as revision_sequence,
        rr.manifest_sha256,
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
            'published_at', version.published_at
          ) order by version.sequence desc)
          from app.repository_revisions version
          where version.repository_id = r.id and version.status = 'published'
        ), '[]'::jsonb) as versions,
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
              'evidence_url', rel.evidence_url
            ) as relationship
            from app.repository_relationships rel
            join app.repositories related on related.id = rel.source_repository_id
            where rel.target_repository_id = r.id
              and related.visibility = 'public' and related.status = 'published'
          ) lineage
        ), '[]'::jsonb) as relationships
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

export function kindPath(kind: RepositoryKind): string {
  return kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
}
