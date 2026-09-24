-- The policy service must verify the immutable tokenizer pack itself, not just
-- the hash of its analysis row. Only tokenizer analysis results are included;
-- every other analysis remains represented by its content hash.
create or replace function app.publication_candidate(
  p_repository_id uuid,
  p_revision_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare result jsonb;
begin
  perform 1
  from app.repository_revisions
  where id = p_revision_id
    and repository_id = p_repository_id
    and status in ('review','published')
  for update;
  if not found then return null; end if;

  perform 1 from app.repositories where id = p_repository_id for update;
  select jsonb_build_object(
    'repository_id', repository.id,
    'revision_id', revision.id,
    'commit_sha', revision.commit_sha,
    'kind', repository.kind,
    'license', repository.license,
    'provenance', repository.provenance,
    'metadata_sha256', app.publication_metadata_sha(repository.id),
    'manifest_sha256', revision.manifest_sha256,
    'file_count', revision.file_count,
    'total_size_bytes', revision.total_size_bytes,
    'published_decision', case when revision.status = 'published' then (
      select to_jsonb(decision)
      from app.publication_decisions decision
      where decision.revision_id = revision.id and decision.outcome = 'passed'
      order by decision.created_at desc
      limit 1
    ) else null end,
    'files', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', file.path,
        'sha256', file.sha256,
        'size_bytes', file.size_bytes,
        'storage_state', file.storage_state,
        'scan_status', file.scan_status,
        'inspections', (
          select coalesce(jsonb_agg(to_jsonb(latest)), '[]'::jsonb)
          from (
            select distinct on (inspection.inspector)
              inspection.id,
              inspection.inspector,
              inspection.status,
              inspection.tool_version,
              inspection.completed_at,
              encode(public.digest(inspection.result::text, 'sha256'), 'hex')
                as result_sha256
            from app.repository_file_inspections inspection
            where inspection.repository_file_id = file.id
            order by inspection.inspector, inspection.started_at desc, inspection.id desc
          ) latest
        )
      ) order by file.path), '[]'::jsonb)
      from app.repository_files file
      where file.revision_id = revision.id
    ),
    'analyses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'analysis_type', analysis.analysis_type,
        'status', analysis.status,
        'tool_versions', analysis.tool_versions,
        'completed_at', analysis.completed_at,
        'result', case
          when analysis.analysis_type = 'tokenizer' then analysis.result
          else null
        end,
        'result_sha256', encode(public.digest(analysis.result::text, 'sha256'), 'hex')
      )), '[]'::jsonb)
      from app.repository_revision_analyses analysis
      where analysis.revision_id = revision.id
    )
  ) into result
  from app.repository_revisions revision
  join app.repositories repository on repository.id = revision.repository_id
  where revision.id = p_revision_id;

  return result;
end
$$;

revoke all on function app.publication_candidate(uuid,uuid) from public;
grant execute on function app.publication_candidate(uuid,uuid) to superii_policy;
