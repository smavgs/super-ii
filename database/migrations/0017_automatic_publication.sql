begin;

-- Only the independent publisher service receives this role. Agent and browser
-- tokens never receive database credentials or permission to approve a release.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'superii_policy') then
    create role superii_policy nologin;
  end if;
end $$;

create table if not exists app.publication_keys (
  id text primary key,
  public_key text not null,
  policy_sha256 text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists app.publication_decisions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete restrict,
  revision_id uuid not null references app.repository_revisions(id) on delete restrict,
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  policy_version text not null check (policy_version = 'superii-auto-publish-v1'),
  policy_sha256 text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('passed', 'blocked')),
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  key_id text not null references app.publication_keys(id) on delete restrict,
  payload text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature text not null,
  created_at timestamptz not null default now(),
  check (payload_sha256 = encode(public.digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex')),
  check ((payload::jsonb)->>'repository_id' is not distinct from repository_id::text),
  check ((payload::jsonb)->>'commit_sha' is not distinct from commit_sha),
  check ((payload::jsonb)->>'manifest_sha256' is not distinct from manifest_sha256),
  check ((payload::jsonb)->>'metadata_sha256' is not distinct from metadata_sha256),
  check ((payload::jsonb)->>'revision_id' is not distinct from revision_id::text),
  check ((payload::jsonb)->>'outcome' is not distinct from outcome),
  check ((payload::jsonb)->>'policy_version' is not distinct from policy_version),
  check ((payload::jsonb)->>'policy_sha256' is not distinct from policy_sha256)
);
create index if not exists publication_decisions_revision_idx
  on app.publication_decisions (revision_id, created_at desc, id);
alter table app.publication_keys enable row level security;
alter table app.publication_decisions enable row level security;
drop policy if exists publication_keys_policy_read on app.publication_keys;
create policy publication_keys_policy_read on app.publication_keys for select to superii_policy using (true);
drop policy if exists publication_decisions_policy_read on app.publication_decisions;
create policy publication_decisions_policy_read on app.publication_decisions for select to superii_policy using (true);

create or replace function app.immutable_publication_decision()
returns trigger language plpgsql as $$
begin
  raise exception 'publication_decisions_are_append_only' using errcode = '23514';
end $$;
drop trigger if exists publication_decisions_immutable on app.publication_decisions;
create trigger publication_decisions_immutable before update or delete on app.publication_decisions
for each row execute function app.immutable_publication_decision();

create or replace function app.publication_metadata_sha(p_repository_id uuid)
returns text language sql stable set search_path = app, pg_catalog as $$
  select encode(public.digest(convert_to(jsonb_build_object(
    'license', license, 'provenance', provenance,
    'owner_profile_id', owner_profile_id, 'owner_organization_id', owner_organization_id,
    'visibility', visibility, 'kind', kind
  )::text, 'UTF8'), 'sha256'), 'hex') from app.repositories where id = p_repository_id
$$;

-- Serializes file mutation against finalization and publication. A published
-- release is immutable; corrections create a new revision.
create or replace function app.guard_release_file_mutation()
returns trigger language plpgsql set search_path = app, pg_catalog as $$
declare target_status public.repository_revision_status;
begin
  select status into target_status from app.repository_revisions
  where id = case when TG_OP = 'DELETE' then old.revision_id else new.revision_id end for update;
  if TG_OP = 'UPDATE' and old.revision_id is distinct from new.revision_id then
    if exists(select 1 from app.repository_revisions where id = old.revision_id and status in ('review','published')) then
      raise exception 'release_files_are_locked' using errcode = '23514';
    end if;
  end if;
  if target_status in ('review', 'published') then
    raise exception 'release_files_are_locked' using errcode = '23514';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists repository_files_release_lock on app.repository_files;
create trigger repository_files_release_lock before insert or update or delete on app.repository_files
for each row execute function app.guard_release_file_mutation();

-- Old approval records remain historical. They confer no publication power.
create or replace function app.publish_repository_revision(p_revision_id uuid, p_actor_id text)
returns void language plpgsql security invoker set search_path = app, pg_catalog as $$
declare
  target app.repository_revisions;
  decision app.publication_decisions;
  actual_manifest text;
begin
  select * into target from app.repository_revisions where id = p_revision_id for update;
  if target.id is null then raise exception 'revision_not_found'; end if;
  if target.status = 'published' then return; end if;
  if target.status <> 'review' then raise exception 'revision_not_finalized'; end if;
  perform 1 from app.repositories where id = target.repository_id for update;
  select * into decision from app.publication_decisions d
  where d.revision_id = target.id order by d.created_at desc, d.id desc limit 1;
  if decision.id is null or decision.outcome <> 'passed'
     or decision.repository_id <> target.repository_id
     or decision.commit_sha <> target.commit_sha
     or decision.manifest_sha256 <> target.manifest_sha256
     or decision.metadata_sha256 <> app.publication_metadata_sha(target.repository_id)
     or decision.created_at < now() - interval '5 minutes'
     or not exists (select 1 from app.publication_keys k where k.id = decision.key_id
                    and k.enabled and k.policy_sha256 = decision.policy_sha256) then
    raise exception 'automatic_publication_attestation_required';
  end if;
  select encode(public.digest(coalesce(string_agg(
    convert_to(f.path, 'UTF8') || decode('00', 'hex') || convert_to(f.sha256, 'UTF8')
    || decode('00', 'hex') || convert_to(f.size_bytes::text || E'\n', 'UTF8'),
    ''::bytea order by f.path collate "C"), ''::bytea), 'sha256'), 'hex')
  into actual_manifest from app.repository_files f where f.revision_id = target.id;
  if target.file_count = 0 or actual_manifest <> target.manifest_sha256
    or target.file_count <> (select count(*) from app.repository_files where revision_id = target.id)
    or target.total_size_bytes <> (select sum(size_bytes) from app.repository_files where revision_id = target.id)
    or exists (select 1 from app.repository_files where revision_id = target.id
               and (storage_state <> 'available' or scan_status <> 'clean')) then
    raise exception 'revision_manifest_or_files_invalid';
  end if;
  if exists (
    select 1 from app.repository_files f
    cross join unnest(array['clamav','gitleaks','format_policy']) required(inspector)
    where f.revision_id = target.id and coalesce((
      select i.status = 'passed' and i.completed_at is not null
        and coalesce(length(i.tool_version), 0) > 0
      from app.repository_file_inspections i
      where i.repository_file_id = f.id and i.inspector = required.inspector
      order by i.started_at desc, i.id desc limit 1
    ), false) = false
  ) then raise exception 'latest_required_scans_not_passed'; end if;
  if not exists (select 1 from app.repository_revision_analyses a
    join app.repositories r on r.id = a.repository_id
    where a.revision_id = target.id and a.analysis_type = r.kind::text and a.status = 'passed'
      and a.completed_at is not null and a.tool_versions <> '{}'::jsonb) then
    raise exception 'repository_analysis_not_passed';
  end if;
  update app.repository_revisions set status = 'published', published_at = now()
  where id = target.id;
  update app.repositories set status = 'published', published_at = coalesce(published_at, now())
  where id = target.repository_id;
  insert into app.audit_events(actor_id, action, target_type, target_id, metadata)
  values ('policy:' || decision.key_id, 'repository_revision.published', 'repository_revision',
          target.id::text, jsonb_build_object('decision_id', decision.id,
          'manifest_sha256', decision.manifest_sha256, 'policy_sha256', decision.policy_sha256,
          'requested_by', p_actor_id, 'human_review_required', false));
end $$;
revoke all on function app.publish_repository_revision(uuid,text) from public;

create or replace function app.apply_publication_decision(p_payload text, p_signature text, p_key_id text)
returns uuid language plpgsql security definer set search_path = app, pg_catalog as $$
declare data jsonb := p_payload::jsonb; decision_id uuid; target app.repository_revisions;
begin
  select * into target from app.repository_revisions where id = (data->>'revision_id')::uuid for update;
  perform 1 from app.repositories where id = target.repository_id for update;
  if target.id is null or target.repository_id::text is distinct from data->>'repository_id'
    or target.commit_sha is distinct from data->>'commit_sha'
    or target.manifest_sha256 is distinct from data->>'manifest_sha256'
    or app.publication_metadata_sha(target.repository_id) is distinct from data->>'metadata_sha256' then
    raise exception 'publication_inputs_changed';
  end if;
  if target.status = 'published' then
    select id into decision_id from app.publication_decisions where revision_id = target.id
      and outcome = 'passed' order by created_at desc limit 1;
    return decision_id;
  end if;
  if target.status <> 'review' then raise exception 'revision_not_finalized'; end if;
  if not exists(select 1 from app.publication_keys where id = p_key_id and enabled
      and policy_sha256 = data->>'policy_sha256') then raise exception 'untrusted_publication_key'; end if;
  insert into app.publication_decisions(repository_id, revision_id, commit_sha, manifest_sha256, metadata_sha256,
    policy_version, policy_sha256, outcome, reasons, evidence, key_id, payload, payload_sha256, signature)
  values (target.repository_id, target.id, target.commit_sha, data->>'manifest_sha256', data->>'metadata_sha256',
    data->>'policy_version', data->>'policy_sha256', data->>'outcome', data->'reasons', data->'evidence',
    p_key_id, p_payload, encode(public.digest(convert_to(p_payload,'UTF8'),'sha256'),'hex'), p_signature)
  returning id into decision_id;
  if data->>'outcome' = 'passed' then
    perform app.publish_repository_revision(target.id, 'authorized-submission');
  else
    -- A creator may fix metadata or replace quarantined files and resubmit.
    update app.repository_revisions set status = 'quarantined' where id = target.id;
  end if;
  return decision_id;
end $$;
revoke all on function app.apply_publication_decision(text,text,text) from public;
grant usage on schema app to superii_policy;
grant select on app.repositories, app.repository_revisions, app.repository_files,
  app.repository_file_inspections, app.repository_revision_analyses,
  app.publication_keys, app.publication_decisions to superii_policy;
grant execute on function app.apply_publication_decision(text,text,text) to superii_policy;
grant execute on function app.publication_metadata_sha(uuid) to superii_policy;

-- No silent relabeling of old human approvals or contribution-job reviews.
alter table app.agent_action_receipts drop constraint if exists agent_action_receipts_review_boundary_check;
alter table app.agent_action_receipts add constraint agent_action_receipts_review_boundary_check
  check (review_boundary in ('human-review-required','human-approved','not-applicable','automatic-policy'));


create or replace function app.publication_candidate(p_repository_id uuid, p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare result jsonb;
begin
  perform 1 from app.repository_revisions where id = p_revision_id and repository_id = p_repository_id
    and status in ('review','published') for update;
  if not found then return null; end if;
  perform 1 from app.repositories where id = p_repository_id for update;
  select jsonb_build_object(
    'repository_id', r.id, 'revision_id', rr.id, 'commit_sha', rr.commit_sha, 'kind', r.kind,
    'license', r.license, 'provenance', r.provenance,
    'metadata_sha256', app.publication_metadata_sha(r.id),
    'manifest_sha256', rr.manifest_sha256, 'file_count', rr.file_count,
    'total_size_bytes', rr.total_size_bytes,
    'published_decision', case when rr.status = 'published' then
      (select to_jsonb(d) from app.publication_decisions d where d.revision_id = rr.id
        and d.outcome = 'passed' order by d.created_at desc limit 1) else null end,
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
      'path', f.path, 'sha256', f.sha256, 'size_bytes', f.size_bytes,
      'storage_state', f.storage_state, 'scan_status', f.scan_status,
      'inspections', (select coalesce(jsonb_agg(to_jsonb(latest)), '[]'::jsonb) from (
        select distinct on (i.inspector) i.id, i.inspector, i.status, i.tool_version,
          i.completed_at, encode(public.digest(i.result::text, 'sha256'), 'hex') as result_sha256
        from app.repository_file_inspections i where i.repository_file_id = f.id
        order by i.inspector, i.started_at desc, i.id desc
      ) latest)
    ) order by f.path), '[]'::jsonb) from app.repository_files f where f.revision_id = rr.id),
    'analyses', (select coalesce(jsonb_agg(jsonb_build_object(
      'analysis_type', a.analysis_type, 'status', a.status, 'tool_versions', a.tool_versions,
      'completed_at', a.completed_at, 'result_sha256', encode(public.digest(a.result::text, 'sha256'), 'hex')
    )), '[]'::jsonb) from app.repository_revision_analyses a where a.revision_id = rr.id)
  ) into result from app.repository_revisions rr join app.repositories r on r.id = rr.repository_id
  where rr.id = p_revision_id;
  return result;
end $$;
revoke all on function app.publication_candidate(uuid,uuid) from public;
grant execute on function app.publication_candidate(uuid,uuid) to superii_policy;

alter table app.agent_access_tokens drop constraint if exists agent_access_tokens_scopes_check;
alter table app.agent_access_tokens add constraint agent_access_tokens_scopes_check check (
  cardinality(scopes) between 1 and 9 and scopes <@ array[
    'repository:read','repository:create','repository:upload','repository:commit','repository:submit',
    'events:read','receipts:read','jobs:claim','jobs:submit']::text[]
);
create or replace function app.consume_agent_access_token(
  p_token_hash text,
  p_scope text,
  p_repository_id uuid default null
)
returns table(
  token_id uuid,
  agent_identity_id uuid,
  operator_profile_id uuid,
  operator_organization_id uuid,
  granted_scopes text[],
  bound_repository_id uuid
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope not in (
      'repository:read', 'repository:create', 'repository:upload', 'repository:commit',
      'repository:submit', 'events:read', 'receipts:read',
      'jobs:claim', 'jobs:submit'
    ) then
    return;
  end if;

  return query
  update app.agent_access_tokens token
  set actions_used = token.actions_used + 1,
      last_used_at = now()
  from app.agent_identities identity,
       app.service_accounts service_account,
       app.organization_members operator_member
  where token.token_hash = p_token_hash
    and identity.id = token.agent_identity_id
    and service_account.id = identity.service_account_id
    and operator_member.organization_id = identity.organization_id
    and operator_member.profile_id = token.created_by_profile_id
    and operator_member.role in ('owner', 'admin')
    and service_account.disabled_at is null
    and identity.status = 'active'
    and token.revoked_at is null
    and token.expires_at > now()
    and token.actions_used < token.max_actions
    and p_scope = any(token.scopes)
    and (token.repository_id is null or token.repository_id = p_repository_id)
    and (
      p_repository_id is null
      or exists (
        select 1 from app.repositories repository
        where repository.id = p_repository_id
          and repository.owner_organization_id = identity.organization_id
      )
    )
  returning
    token.id,
    identity.id,
    token.created_by_profile_id,
    identity.organization_id,
    token.scopes,
    token.repository_id;
end;
$$;
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

  update app.repositories
  set card_markdown = left(coalesce(p_card_markdown, ''), 100000),
      provenance = provenance || jsonb_build_object(
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
