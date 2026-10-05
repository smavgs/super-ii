\set ON_ERROR_STOP on
begin;
do $$
declare actor uuid; created record; next_revision app.repository_revisions; initial jsonb;
begin
  actor := app.ensure_profile('creator-editor-test','creator-editor-test','Creator Test',null);
  select * into created from app.create_repository_with_revision(actor,null,'model','editor-fixture',
    'Original title','Original summary', 'mit','text-generation','transformers','text','# Original','{}');
  select presentation into initial from app.repository_revisions where id = created.revision_id;
  if initial->>'title' <> 'Original title' then raise exception 'presentation_not_initialized'; end if;
  update app.repository_revisions set presentation = presentation || '{"title":"Draft title"}'::jsonb where id = created.revision_id;
  if (select title from app.repositories where id = created.repository_id) <> 'Original title' then raise exception 'draft_changed_public_metadata'; end if;
  if (select presentation_version from app.repository_revisions where id = created.revision_id) <> 1 then raise exception 'missing_conflict_version'; end if;
  -- A sealed parent can be copied without changing its card or inheriting scans.
  update app.repository_revisions set status='review' where id=created.revision_id;
  select * into next_revision from app.create_repository_commit(created.repository_id,created.branch_id,'Edit page',actor::text);
  if next_revision.presentation->>'title' <> 'Draft title' then raise exception 'draft_did_not_inherit_presentation'; end if;
  update app.repository_revisions set presentation = presentation || '{"title":"Next title"}'::jsonb where id=next_revision.id;
  if (select presentation->>'title' from app.repository_revisions where id=created.revision_id) <> 'Draft title' then raise exception 'parent_changed'; end if;
  -- Publication must bind the visible card to a clean README in this revision.
  update app.repository_revisions set presentation = presentation || jsonb_build_object(
    'card_markdown','# Correct README', 'readme_sha256', repeat('b',64)) where id=next_revision.id;
  begin
    update app.repository_revisions set status='published' where id=next_revision.id;
    raise exception 'mismatched_readme_published';
  exception when sqlstate '55000' then
    if sqlerrm <> 'readme_presentation_mismatch' then raise; end if;
  end;
  update app.repository_revisions set presentation = presentation || jsonb_build_object(
    'readme_sha256',encode(public.digest(convert_to('# Correct README','UTF8'),'sha256'),'hex')) where id=next_revision.id;
  begin
    update app.repository_revisions set status='published' where id=next_revision.id;
    raise exception 'missing_readme_published';
  exception when sqlstate '55000' then
    if sqlerrm <> 'readme_presentation_mismatch' then raise; end if;
  end;
  -- Superuser fixture transition tests presentation sync; policy authorization
  -- and signed attestations are exercised separately by interaction_smoke.sql.
  insert into app.repository_files(repository_id,revision_id,path,size_bytes,mime_type,sha256,
    storage_key,storage_state,scan_status,created_by)
    values(created.repository_id,next_revision.id,'README.md',15,'text/markdown',
      encode(public.digest(convert_to('# Correct README','UTF8'),'sha256'),'hex'),
      'objects/creator-fixture','available','clean',actor::text);
  update app.repository_revisions set status='published',published_at=now(),file_count=1,
    total_size_bytes=15,manifest_sha256=repeat('c',64),commit_sha=repeat('d',64),
    manifest='[{"path":"README.md"}]'::jsonb where id=next_revision.id;
  if (select title from app.repositories where id=created.repository_id) <> 'Next title'
     or (select card_markdown from app.repositories where id=created.repository_id) <> '# Correct README' then
    raise exception 'publication_did_not_sync_presentation';
  end if;
  begin
    update app.repository_revisions set presentation=presentation || '{"title":"Forbidden"}'::jsonb where id=next_revision.id;
    raise exception 'published_edit_allowed';
  exception when sqlstate '55000' then null; end;
  begin
    update app.repository_revisions set status='quarantined' where id=next_revision.id;
    raise exception 'published_revision_reopened';
  exception when sqlstate '55000' then null; end;
  if has_function_privilege('superii_web_backend','app.finish_bridge_in_workspace(uuid)','EXECUTE') then raise exception 'web_can_reopen_bridge_revision'; end if;
end $$;

do $$
declare actor uuid; job uuid; item app.bridge_import_items; destination record; selection jsonb;
begin
  actor := app.ensure_profile('creator-bridge-test','creator-bridge-test','Bridge Test',null);
  selection := jsonb_build_array(jsonb_build_object(
    'provider_repo_id','creator/editor-import','source_revision',repeat('a',40),
    'source_url','https://huggingface.co/creator/editor-import','kind','model',
    'title','Editor import','summary','Test import','license','mit','source_visibility','public',
    'file_count',1,'total_size_bytes',4,'largest_file_bytes',4,'source_manifest','[]'::jsonb));
  job := app.create_bridge_editor_import(actor,'huggingface',null,
    'https://huggingface.co/creator/editor-import',selection,true,true);
  if app.create_bridge_editor_import(actor,'huggingface',null,
    'https://huggingface.co/creator/editor-import',selection,true,false) <> job then
    raise exception 'bridge_replay_duplicated_job';
  end if;
  if (select metadata->>'finish_in_workspace' from app.bridge_import_jobs where id=job) <> 'true' then
    raise exception 'bridge_replay_changed_completion';
  end if;
  perform app.claim_next_bridge_import();
  select * into item from app.claim_next_bridge_item(job);
  select * into destination from app.prepare_bridge_item(item.id);
  update app.repository_revisions set status='review', manifest_sha256=repeat('c',64),
    commit_sha=repeat('d',64) where id=destination.revision_id;
  perform app.complete_bridge_item(item.id,'# Imported page','[]'::jsonb);
  if not app.finish_bridge_in_workspace(item.id) then raise exception 'bridge_not_held'; end if;
  if not app.finish_bridge_in_workspace(item.id) then raise exception 'bridge_hold_not_idempotent'; end if;
  if (select status from app.repository_revisions where id=destination.revision_id) <> 'quarantined'
     or (select manifest_sha256 from app.repository_revisions where id=destination.revision_id) is not null then
    raise exception 'bridge_not_editable';
  end if;
  if (select status from app.bridge_import_jobs where id=job) <> 'complete' then
    raise exception 'bridge_completion_not_atomic';
  end if;
  if (select card_markdown from app.repositories where id=destination.repository_id) <> '' then
    raise exception 'bridge_draft_card_leaked';
  end if;
end $$;
rollback;
