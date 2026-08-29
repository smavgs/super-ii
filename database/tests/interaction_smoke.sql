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
  created_repository record;
  created_commit app.repository_revisions;
  payment_order_id uuid;
  team_payment_order_id uuid;
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
    publish_repository_id, revision_row.id, 'model', 'passed', '{"offline":true}', now()
  );
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
end;
$$;

rollback;
