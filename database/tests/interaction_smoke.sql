\set ON_ERROR_STOP on

begin;

do $$
declare
  alice_id uuid;
  bob_id uuid;
  public_repository_id uuid;
  publish_repository_id uuid;
  revision_row app.repository_revisions;
  file_id uuid;
  discussion_id uuid;
  comment_id uuid;
  collection_id uuid;
  new_organization_id uuid;
  resource_group_id uuid;
  service_account_id uuid;
  created_repository record;
  created_commit app.repository_revisions;
  payment_order_id uuid;
  team_payment_order_id uuid;
  resumable_upload app.repository_uploads;
  notebook_session_id uuid;
begin
  alice_id := app.ensure_profile('clerk-alice', 'alice', 'Alice', null);
  bob_id := app.ensure_profile('clerk-bob', 'bob', 'Bob', null);

  new_organization_id := app.create_organization(
    alice_id,
    'alice-labs',
    'company',
    'Alice Labs',
    'https://example.test',
    null,
    'alice-labs',
    'alice_labs',
    'https://www.linkedin.com/company/alice-labs',
    '["open models", "dataset quality"]'::jsonb
  );
  if not exists (
    select 1 from app.organization_members
    where organization_id = new_organization_id and profile_id = alice_id and role = 'owner'
  ) then
    raise exception 'organization owner was not created';
  end if;

  select * into created_repository
  from app.create_repository_with_revision(
    alice_id,
    new_organization_id,
    'dataset',
    'creator-flow',
    'Creator flow',
    'Repository creator integration test',
    'apache-2.0',
    'tabular-classification',
    'datasets',
    'tabular',
    '# Data Card',
    '{"sources":["integration-test"]}'::jsonb
  );
  if created_repository.repository_id is null
    or created_repository.revision_id is null
    or created_repository.branch_id is null then
    raise exception 'repository creator did not return the full initial state';
  end if;
  if not exists (
    select 1 from app.repository_branches
    where id = created_repository.branch_id and is_default and name = 'main'
  ) then
    raise exception 'default repository branch was not created';
  end if;

  select * into resumable_upload
  from app.create_resumable_upload(
    created_repository.repository_id,
    created_repository.revision_id,
    alice_id,
    'large/training-data.parquet',
    'training-data.parquet',
    'application/vnd.apache.parquet',
    8,
    repeat('1', 64),
    repeat('2', 64),
    alice_id::text,
    now() + interval '1 hour'
  );
  select * into resumable_upload
  from app.advance_resumable_upload(resumable_upload.id, 0, 4);
  if resumable_upload.offset_bytes <> 4 or resumable_upload.state <> 'uploading' then
    raise exception 'resumable upload offset was not advanced atomically';
  end if;
  begin
    perform app.advance_resumable_upload(resumable_upload.id, 0, 8);
    raise exception 'resumable upload accepted a stale offset';
  exception
    when serialization_failure then null;
  end;
  select * into resumable_upload
  from app.advance_resumable_upload(resumable_upload.id, 4, 8);
  if resumable_upload.state <> 'uploaded' then
    raise exception 'resumable upload did not reach uploaded state';
  end if;
  perform app.transition_resumable_upload(
    resumable_upload.id, array['uploaded'], 'scanning',
    repeat('1', 64), null, '{"scanner":"pending"}'::jsonb, null
  );
  perform app.transition_resumable_upload(
    resumable_upload.id, array['scanning'], 'rejected',
    repeat('1', 64), null, '{"scanner":"smoke"}'::jsonb, 'smoke_rejection'
  );

  insert into app.resource_groups (
    organization_id, slug, name, description, created_by_profile_id
  ) values (
    new_organization_id, 'public-releases', 'Public releases',
    'Scoped repository permissions', alice_id
  ) returning id into resource_group_id;
  insert into app.resource_group_repositories (resource_group_id, repository_id)
  values (resource_group_id, created_repository.repository_id);
  insert into app.resource_group_members (resource_group_id, profile_id, role)
  values (resource_group_id, bob_id, 'reader');
  if not app.has_repository_permission(bob_id, created_repository.repository_id, 'read')
    or app.has_repository_permission(bob_id, created_repository.repository_id, 'upload') then
    raise exception 'resource group permissions were not applied fail closed';
  end if;

  insert into app.service_accounts (
    organization_id, name, description, created_by_profile_id
  ) values (
    new_organization_id, 'release-bot', 'Trusted publishing smoke test', alice_id
  ) returning id into service_account_id;
  insert into app.service_account_roles (service_account_id, resource_group_id, role)
  values (service_account_id, resource_group_id, 'publisher');
  insert into app.scoped_access_tokens (
    repository_id, service_account_id, created_by_profile_id,
    token_prefix, token_hash, scopes, expires_at
  ) values (
    created_repository.repository_id, service_account_id, alice_id,
    'sii_test1234', repeat('e', 64), '["repository:publish"]'::jsonb,
    now() + interval '5 minutes'
  );

  update app.repository_revisions
  set status = 'rejected'
  where id = created_repository.revision_id;
  select * into created_commit
  from app.create_repository_commit(
    created_repository.repository_id,
    created_repository.branch_id,
    'Second commit',
    alice_id::text
  );
  if created_commit.parent_revision_id <> created_repository.revision_id
    or created_commit.branch_id <> created_repository.branch_id then
    raise exception 'repository commit did not preserve branch history';
  end if;
  if not exists (
    select 1 from app.repository_branches
    where id = created_repository.branch_id and head_revision_id = created_commit.id
  ) then
    raise exception 'repository commit did not advance the branch head';
  end if;

  insert into app.payment_orders (
    profile_id, plan_id, price_amount_cents, provider_payment_id, status
  ) values (
    alice_id, 'pro', 900, 'smoke-payment-1', 'waiting'
  ) returning id into payment_order_id;
  if not app.apply_nowpayments_status(
    payment_order_id,
    'smoke-payment-1',
    'finished',
    '{"payment_status":"finished"}'::jsonb
  ) then
    raise exception 'payment status was not applied';
  end if;
  if not exists (
    select 1 from app.subscriptions
    where provider_subscription_id = 'smoke-payment-1' and status = 'active'
  ) then
    raise exception 'finished payment did not activate a subscription';
  end if;
  perform app.apply_nowpayments_status(
    payment_order_id,
    'smoke-payment-1',
    'waiting',
    '{"payment_status":"waiting"}'::jsonb
  );
  if (select status from app.payment_orders where id = payment_order_id) <> 'finished' then
    raise exception 'finished payment regressed after an out-of-order callback';
  end if;
  perform app.apply_nowpayments_status(
    payment_order_id,
    'smoke-payment-1',
    'refunded',
    '{"payment_status":"refunded"}'::jsonb
  );
  if not exists (
    select 1 from app.subscriptions
    where provider_subscription_id = 'smoke-payment-1' and status = 'canceled'
  ) then
    raise exception 'refunded payment did not close its entitlement';
  end if;

  select id into team_payment_order_id
  from app.create_or_reuse_payment_order(
    alice_id,
    new_organization_id,
    'team',
    2,
    4000
  );
  update app.payment_orders
  set provider_payment_id = 'smoke-payment-team', status = 'waiting'
  where id = team_payment_order_id;
  perform app.apply_nowpayments_status(
    team_payment_order_id,
    'smoke-payment-team',
    'finished',
    '{"payment_status":"finished"}'::jsonb
  );
  if not exists (
    select 1 from app.subscriptions
    where provider_subscription_id = 'smoke-payment-team'
      and organization_id = new_organization_id
      and clerk_user_id is null
      and status = 'active'
  ) then
    raise exception 'team payment did not activate the organization entitlement';
  end if;

  insert into app.repositories (
    kind, owner_handle, slug, title, summary, visibility, status, published_at
  ) values (
    'model', 'alice', 'public-model', 'Public model', 'Interaction test repository',
    'public', 'published', now()
  ) returning id into public_repository_id;

  insert into app.agent_traces (
    repository_id, trace_id, agent_name, tool_name, status, is_public
  ) values (
    public_repository_id, 'trace-smoke-0001', 'release-bot', 'verify_manifest',
    'succeeded', true
  );

  if not app.set_repository_like(public_repository_id, alice_id, true) then
    raise exception 'like was not activated';
  end if;
  if app.set_repository_watch(public_repository_id, alice_id, 'releases') <> 'releases' then
    raise exception 'watch level was not stored';
  end if;
  if not app.set_profile_follow(alice_id, bob_id, true) then
    raise exception 'follow was not activated';
  end if;

  discussion_id := app.create_discussion(
    public_repository_id, alice_id, 'A real discussion', 'The discussion body.'
  );
  comment_id := app.add_discussion_comment(
    discussion_id, bob_id, null, 'A useful comment.'
  );
  if not app.set_reaction(alice_id, 'comment', comment_id, 'helpful', true) then
    raise exception 'reaction was not activated';
  end if;

  insert into app.collections (owner_profile_id, slug, title, summary)
  values (alice_id, 'smoke-test', 'Smoke test', 'Collection test')
  returning id into collection_id;
  insert into app.collection_items (collection_id, repository_id)
  values (collection_id, public_repository_id);

  if not app.consume_request_limit(repeat('a', 64), 'smoke', 2, 3600)
    or not app.consume_request_limit(repeat('a', 64), 'smoke', 2, 3600)
    or app.consume_request_limit(repeat('a', 64), 'smoke', 2, 3600) then
    raise exception 'rate limit did not fail closed at the configured limit';
  end if;

  insert into app.repositories (
    kind, owner_handle, slug, title, summary, visibility, status
  ) values (
    'model', 'alice', 'publish-gate', 'Publish gate', 'Publication contract test',
    'public', 'draft'
  ) returning id into publish_repository_id;

  select * into revision_row
  from app.create_repository_revision(
    publish_repository_id, null, 'Initial revision', 'smoke-test'
  );

  insert into app.repository_files (
    repository_id, revision_id, path, size_bytes, mime_type, sha256,
    storage_key, storage_state, scan_status, created_by
  ) values (
    publish_repository_id, revision_row.id, 'model.safetensors', 4,
    'application/octet-stream', repeat('b', 64),
    'objects/sha256/bb/' || repeat('b', 64), 'available', 'clean', 'smoke-test'
  ) returning id into file_id;

  insert into app.repository_file_inspections (
    repository_file_id, inspector, status, tool_version, completed_at
  ) values
    (file_id, 'clamav', 'passed', 'smoke', now()),
    (file_id, 'gitleaks', 'passed', 'smoke', now());

  insert into app.repository_revision_analyses (
    repository_id, revision_id, analysis_type, status, result, completed_at
  ) values (
    publish_repository_id,
    revision_row.id,
    'model',
    'passed',
    '{"offline":true,"compatibility":{"architecture":"smoke","model_size_bytes":4,"minimum_ram_bytes":1073741824,"minimum_vram_bytes":0,"cpu_compatible":true,"llama_cpp_compatible":false,"confidence":"derived"}}',
    now()
  );
  insert into app.repository_revision_analyses (
    repository_id, revision_id, analysis_type, status, result, completed_at
  ) values (
    publish_repository_id,
    revision_row.id,
    'notebook',
    'passed',
    '{"static_only":true,"code_executed":false,"notebook_count":1,"notebooks":[]}',
    now()
  );
  if not exists (
    select 1 from app.repository_revision_analyses
    where revision_id = revision_row.id and analysis_type = 'notebook' and status = 'passed'
  ) then
    raise exception 'notebook analysis contract was not stored';
  end if;
  if not exists (
    select 1 from app.repository_compatibility
    where revision_id = revision_row.id
      and minimum_ram_bytes = 1073741824
      and cpu_compatible
  ) then
    raise exception 'model compatibility was not synchronized';
  end if;
  update app.repository_revision_analyses
  set status = 'failed'
  where revision_id = revision_row.id and analysis_type = 'model';
  if exists (select 1 from app.repository_compatibility where revision_id = revision_row.id) then
    raise exception 'failed model analysis left stale compatibility data';
  end if;
  update app.repository_revision_analyses
  set status = 'passed'
  where revision_id = revision_row.id and analysis_type = 'model';
  insert into app.repository_reviews (
    repository_id, revision_id, reviewer_id, decision
  ) values (publish_repository_id, revision_row.id, 'human-reviewer', 'approved');
  update app.repository_revisions
  set manifest_sha256 = repeat('c', 64),
      commit_sha = repeat('d', 64),
      manifest = jsonb_build_array(jsonb_build_object(
        'path', 'model.safetensors',
        'sha256', repeat('b', 64),
        'size_bytes', 4,
        'mime_type', 'application/octet-stream'
      )),
      file_count = 1,
      total_size_bytes = 4,
      status = 'review'
  where id = revision_row.id;

  begin
    perform app.publish_repository_revision(revision_row.id, 'smoke-test');
    raise exception 'publish unexpectedly bypassed format policy';
  exception
    when others then
      if sqlerrm <> 'required_scans_not_passed' then
        raise;
      end if;
  end;

  insert into app.repository_file_inspections (
    repository_file_id, inspector, status, tool_version, completed_at
  ) values (file_id, 'format_policy', 'passed', 'smoke', now());
  perform app.publish_repository_revision(revision_row.id, 'smoke-test');

  if not exists (
    select 1 from app.repositories
    where id = publish_repository_id and status = 'published' and latest_revision_id = revision_row.id
  ) then
    raise exception 'published revision did not become the repository head';
  end if;
  if (select count(*) from app.search_public_repositories('publish gate')) < 1 then
    raise exception 'published repository was not searchable';
  end if;
  if (select count(*) from app.activity_events) < 5 then
    raise exception 'community activity trail is incomplete';
  end if;

  insert into app.cas_integrity_events (sha256, event_type, size_bytes, receipt)
  values (repeat('b', 64), 'verified', 4, '{"source":"smoke"}'::jsonb);
  insert into app.runtime_benchmark_records (
    category, repository_id, revision_id, runtime, runtime_version,
    model_sha256, hardware, parameters, metrics, provenance
  ) values (
    'storage', publish_repository_id, revision_row.id, 'superii-rust-cas', '0.1.0',
    repeat('b', 64), '{"machine":"ci"}'::jsonb, '{"bytes":4}'::jsonb,
    '{"seconds":0.001}'::jsonb, '{"commit":"smoke","scope":"local"}'::jsonb
  );
  insert into app.notebook_execution_sessions (
    repository_id, revision_id, notebook_path, profile_id,
    cpu_limit, memory_limit_bytes, pids_limit, timeout_seconds, expires_at
  ) values (
    publish_repository_id, revision_row.id, 'evaluation.ipynb', alice_id,
    1.0, 536870912, 64, 60, now() + interval '5 minutes'
  ) returning id into notebook_session_id;
  perform app.transition_notebook_execution(
    notebook_session_id, array['queued'], 'running', 'superii-notebook-smoke'
  );
  perform app.transition_notebook_execution(
    notebook_session_id, array['running'], 'succeeded',
    'superii-notebook-smoke', repeat('f', 64), 0, null
  );
  if not exists (
    select 1 from app.notebook_execution_sessions
    where id = notebook_session_id and status = 'succeeded'
      and network_disabled and not secrets_injected
  ) then
    raise exception 'isolated notebook lifecycle contract was not preserved';
  end if;
end;
$$;

rollback;
