-- Revision-bound authoring. Existing public cards are preserved; new README
-- snapshots are checked against the scanned file manifest before publication.
begin;

alter table app.repository_revisions
  add column if not exists presentation jsonb not null default '{}'::jsonb,
  add column if not exists presentation_version integer not null default 0;

update app.repository_revisions rr set presentation = jsonb_build_object(
  'title', r.title, 'summary', r.summary, 'task', coalesce(r.task,''),
  'library', coalesce(r.library,''), 'modality', coalesce(r.modality,''),
  'card_markdown', r.card_markdown
) from app.repositories r where r.id = rr.repository_id and rr.presentation = '{}'::jsonb;

create or replace function app.initialize_revision_presentation()
returns trigger language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if new.presentation = '{}'::jsonb then
    select presentation into new.presentation from app.repository_revisions
      where id = new.parent_revision_id and repository_id = new.repository_id;
    if new.presentation is null then
      select jsonb_build_object('title',title,'summary',summary,'task',coalesce(task,''),
        'library',coalesce(library,''),'modality',coalesce(modality,''),'card_markdown',card_markdown)
      into new.presentation from app.repositories where id = new.repository_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists repository_revision_initial_presentation on app.repository_revisions;
create trigger repository_revision_initial_presentation before insert on app.repository_revisions
for each row execute function app.initialize_revision_presentation();

create or replace function app.guard_revision_presentation()
returns trigger language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if old.status = 'published' and new.status <> 'published' then
    raise exception 'published_presentation_is_immutable' using errcode = '55000';
  end if;
  if new.presentation is distinct from old.presentation then
    if old.status = 'published' then
      raise exception 'published_presentation_is_immutable' using errcode = '55000';
    end if;
    if jsonb_typeof(new.presentation) <> 'object'
       or octet_length(coalesce(new.presentation->>'card_markdown','')) > 100000
       or char_length(coalesce(new.presentation->>'title','')) not between 2 and 200
       or char_length(coalesce(new.presentation->>'summary','')) > 2000 then
      raise exception 'invalid_revision_presentation' using errcode = '22023';
    end if;
    new.presentation_version := old.presentation_version + 1;
  else
    new.presentation_version := old.presentation_version;
  end if;
  if new.status = 'published' and old.status <> 'published'
     and new.presentation ? 'readme_sha256' then
    if new.presentation->>'readme_sha256' is distinct from
         encode(public.digest(convert_to(new.presentation->>'card_markdown','UTF8'),'sha256'),'hex')
       or not exists (select 1 from app.repository_files f where f.revision_id = new.id
         and f.path = 'README.md' and f.sha256 = new.presentation->>'readme_sha256'
         and f.storage_state = 'available' and f.scan_status = 'clean') then
      raise exception 'readme_presentation_mismatch' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists repository_revision_presentation_guard on app.repository_revisions;
create trigger repository_revision_presentation_guard before update on app.repository_revisions
for each row execute function app.guard_revision_presentation();

create or replace function app.sync_published_presentation()
returns trigger language plpgsql security invoker set search_path = app, pg_catalog as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    update app.repositories set
      title = new.presentation->>'title', summary = new.presentation->>'summary',
      task = nullif(new.presentation->>'task',''), library = nullif(new.presentation->>'library',''),
      modality = nullif(new.presentation->>'modality',''), card_markdown = new.presentation->>'card_markdown'
    where id = new.repository_id and latest_revision_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists zz_repository_presentation_published on app.repository_revisions;
create trigger zz_repository_presentation_published after update of status on app.repository_revisions
for each row execute function app.sync_published_presentation();

-- Browser imports explicitly opt into a finishing draft. This only reopens
-- an unpublished Bridge revision, after its source manifest was recorded.
create or replace function app.finish_bridge_in_workspace(p_item_id uuid)
returns boolean language plpgsql security invoker set search_path = app, pg_catalog as $$
declare target app.bridge_import_items;
begin
  select i.* into target from app.bridge_import_items i
    join app.bridge_import_jobs j on j.id = i.job_id
    where i.id = p_item_id and j.metadata->>'finish_in_workspace' = 'true'
    for update of i;
  if target.id is null then return false; end if;
  if exists (select 1 from app.repository_revisions where id = target.revision_id and status = 'published') then
    return false; -- Reusing an existing import never reopens a public revision.
  end if;
  if not exists (select 1 from app.repository_sources where revision_id = target.revision_id) then
    raise exception 'bridge_source_not_recorded';
  end if;
  update app.repository_revisions set status = 'quarantined', commit_sha = null,
    manifest_sha256 = null, manifest = '[]'::jsonb
    where id = target.revision_id and repository_id = target.repository_id
      and (status = 'review' or (status = 'quarantined' and manifest_sha256 is null)) and published_at is null
      and not exists (select 1 from app.publication_decisions where revision_id = target.revision_id);
  if not found then raise exception 'bridge_draft_not_available'; end if;
  update app.bridge_import_items set status = 'complete', progress_bytes = total_size_bytes,
    completed_at = now(), updated_at = now() where id = target.id;
  perform app.refresh_bridge_import(target.job_id);
  return true;
end $$;
revoke all on function app.finish_bridge_in_workspace(uuid) from public, superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.finish_bridge_in_workspace(uuid) to superii_runtime_backend;

create or replace function app.create_bridge_editor_import(
  p_profile uuid, p_provider text, p_identity uuid, p_source text,
  p_repositories jsonb, p_attested boolean, p_finish boolean
) returns uuid language plpgsql security invoker set search_path = app, pg_catalog as $$
declare created uuid;
begin
  created := app.create_bridge_import(p_profile,p_provider,p_identity,p_source,p_repositories,p_attested);
  update app.bridge_import_jobs set metadata = metadata || jsonb_build_object('finish_in_workspace',p_finish)
    where id = created and status = 'queued' and not (metadata ? 'finish_in_workspace');
  return created;
end $$;
revoke all on function app.create_bridge_editor_import(uuid,text,uuid,text,jsonb,boolean,boolean) from public, superii_payment_backend, superii_publishing_backend, superii_runtime_backend;
grant execute on function app.create_bridge_editor_import(uuid,text,uuid,text,jsonb,boolean,boolean) to superii_web_backend;

create or replace function app.complete_bridge_item(
  p_item_id uuid,
  p_card_markdown text,
  p_source_manifest jsonb
)
returns text
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_item app.bridge_import_items;
  target_job app.bridge_import_jobs;
  revision_manifest_sha text;
begin
  select * into target_item from app.bridge_import_items where id = p_item_id for update;
  if target_item.id is null or target_item.repository_id is null or target_item.revision_id is null then
    raise exception 'bridge_item_repository_missing' using errcode = 'P0001';
  end if;
  select * into target_job from app.bridge_import_jobs where id = target_item.job_id;
  select manifest_sha256 into revision_manifest_sha
  from app.repository_revisions
  where id = target_item.revision_id and repository_id = target_item.repository_id and status = 'review';
  if revision_manifest_sha is null then
    raise exception 'bridge_revision_not_ready' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_source_manifest) <> 'array' then
    raise exception 'bridge_source_manifest_invalid' using errcode = 'P0001';
  end if;

  update app.repository_revisions
  set presentation = presentation || jsonb_build_object('card_markdown', left(coalesce(p_card_markdown, ''),100000))
  where id = target_item.revision_id and status = 'review';

  update app.repositories
  set provenance = provenance || jsonb_build_object(
        'bridge', jsonb_build_object(
          'provider', target_job.provider,
          'source_url', target_item.source_url,
          'source_revision', target_item.source_revision,
          'imported_at', now(),
          'source_unchanged', true
        )
      )
  where id = target_item.repository_id;

  insert into app.repository_sources (
    repository_id, revision_id, destination_profile_id, external_identity_id,
    provider, provider_repo_id, source_url, source_revision, observed_license,
    source_manifest, imported_manifest_sha256
  ) values (
    target_item.repository_id, target_item.revision_id, target_job.profile_id,
    target_job.external_identity_id, target_job.provider, target_item.provider_repo_id,
    target_item.source_url, target_item.source_revision, target_item.license,
    p_source_manifest, revision_manifest_sha
  ) on conflict (revision_id) do nothing;

  update app.repository_branches
  set head_revision_id = target_item.revision_id, updated_at = now()
  where repository_id = target_item.repository_id and is_default;
  update app.bridge_import_items
  set status = 'scanning', progress_bytes = total_size_bytes,
      source_manifest = p_source_manifest,
      imported_manifest_sha256 = revision_manifest_sha,
      completed_at = now(), updated_at = now()
  where id = p_item_id;
  update app.bridge_sync_subscriptions
  set last_seen_revision = target_item.source_revision,
      last_import_job_id = target_job.id,
      last_checked_at = now(),
      next_check_at = now() + make_interval(secs => check_interval_seconds),
      consecutive_failures = 0,
      last_error_code = null,
      updated_at = now()
  where repository_id = target_item.repository_id
    and provider = target_job.provider
    and provider_repo_id = target_item.provider_repo_id;
  insert into app.bridge_events (job_id, item_id, event_type, detail)
  values (
    target_job.id, p_item_id, 'item.awaiting_policy',
    jsonb_build_object('repository_id', target_item.repository_id, 'revision_id', target_item.revision_id, 'manifest_sha256', revision_manifest_sha)
  );
  return app.refresh_bridge_import(target_job.id);
end;
$$;

commit;
