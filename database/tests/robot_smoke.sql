\set ON_ERROR_STOP on
begin;

insert into app.profiles (id, clerk_user_id, handle, display_name)
values
  ('10000000-0000-4000-8000-000000000019', 'robot-free-user', 'robot-free', 'Robot Free'),
  ('20000000-0000-4000-8000-000000000019', 'robot-pro-user', 'robot-pro', 'Robot Pro');

select * from app.create_robot_with_version(
  '10000000-0000-4000-8000-000000000019', null, 'public-rover', 'Public Rover',
  'A public Robot smoke test.', 'New makers', 'public',
  '{"goal":"learn"}'::jsonb, '{"catalog_revision":"test","robot_check":[]}'::jsonb,
  'test', 'First public version', null
) \gset public_

do $$ begin
  begin
    perform * from app.create_robot_with_version(
      '10000000-0000-4000-8000-000000000019', null, 'private-denied', 'Private Denied',
      'This private Robot must be denied.', 'New makers', 'private',
      '{}'::jsonb, '{}'::jsonb, 'test', 'Denied version', null
    );
    raise exception 'private free Robot unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

insert into app.subscriptions (clerk_user_id, plan_id, status, current_period_end)
values ('robot-pro-user', 'pro', 'active', now() + interval '30 days');

select * from app.create_robot_with_version(
  '20000000-0000-4000-8000-000000000019', null, 'private-rover', 'Private Rover',
  'A private Robot smoke test.', 'Independent builders', 'private',
  '{"goal":"explore"}'::jsonb, '{"catalog_revision":"test","robot_check":[]}'::jsonb,
  'test', 'First private version', null
) \gset private_

select * from app.create_robot_version(
  '20000000-0000-4000-8000-000000000019', :'private_robot_id',
  '{"goal":"see"}'::jsonb, '{"catalog_revision":"test-2","robot_check":[]}'::jsonb,
  'test-2', 'Second private version', null
) \gset second_

select set_config('test.second_version_id', :'second_version_id', true);
select set_config('test.private_robot_id', :'private_robot_id', true);
select set_config('test.public_robot_id', :'public_robot_id', true);

do $$ begin
  begin
    update app.robot_versions set change_summary = 'mutated' where id = current_setting('test.second_version_id')::uuid;
    raise exception 'immutable Robot version unexpectedly changed';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

insert into app.organizations (id, clerk_organization_id, handle, name)
values ('30000000-0000-4000-8000-000000000019', 'robot-team-org', 'robot-team', 'Robot Team');
insert into app.organization_members (organization_id, profile_id, role)
values ('30000000-0000-4000-8000-000000000019', '20000000-0000-4000-8000-000000000019', 'owner');
insert into app.subscriptions (organization_id, plan_id, provider, provider_subscription_id, status, current_period_end)
values (
  '30000000-0000-4000-8000-000000000019', 'team', 'test', 'robot-team-subscription',
  'active', now() + interval '30 days'
);

select * from app.create_robot_with_version(
  '20000000-0000-4000-8000-000000000019', '30000000-0000-4000-8000-000000000019',
  'team-rover', 'Team Rover', 'A shared organization Robot smoke test.', 'Robot team', 'private',
  '{"goal":"see"}'::jsonb, '{"catalog_revision":"test","robot_check":[]}'::jsonb,
  'test', 'First team version', null
) \gset team_

select * from app.create_agent_identity(
  '20000000-0000-4000-8000-000000000019',
  '30000000-0000-4000-8000-000000000019',
  'robot-smoke-agent', 'Robot Smoke Agent',
  'Exercises the protocol-neutral governed Robot work path.',
  'custom', 'https://example.test/.well-known/agent-card.json', true
) \gset robot_agent_

insert into app.agent_access_tokens (
  agent_identity_id, created_by_profile_id, token_prefix, token_hash,
  scopes, repository_id, max_actions, expires_at
) values (
  :'robot_agent_agent_identity_id', '20000000-0000-4000-8000-000000000019',
  'sii_agent_robot001', repeat('8', 64),
  array['robot:read', 'robot:create', 'robot:update', 'receipts:read'],
  null, 10, now() + interval '5 minutes'
) returning id \gset robot_token_

select * from app.consume_agent_access_token(repeat('8', 64), 'robot:create', null) \gset robot_auth_
select set_config('test.robot_agent_id', :'robot_agent_agent_identity_id', true);
select set_config('test.robot_token_id', :'robot_token_id', true);
select set_config('test.robot_auth_agent_id', :'robot_auth_agent_identity_id', true);
select set_config('test.robot_auth_profile_id', :'robot_auth_operator_profile_id', true);
select set_config('test.robot_auth_organization_id', :'robot_auth_operator_organization_id', true);

do $$
declare
  first_create jsonb;
  replayed_create jsonb;
  first_version jsonb;
  replayed_version jsonb;
  created_robot_id uuid;
begin
  if current_setting('test.robot_auth_agent_id')::uuid <> current_setting('test.robot_agent_id')::uuid
    or current_setting('test.robot_auth_profile_id')::uuid <> '20000000-0000-4000-8000-000000000019'::uuid
    or current_setting('test.robot_auth_organization_id')::uuid <> '30000000-0000-4000-8000-000000000019'::uuid then
    raise exception 'Robot agent token did not resolve its governed operator boundary';
  end if;

  first_create := app.agent_create_robot_with_receipt(
    current_setting('test.robot_agent_id')::uuid,
    current_setting('test.robot_token_id')::uuid,
    '20000000-0000-4000-8000-000000000019',
    '30000000-0000-4000-8000-000000000019',
    'robot-agent-create-0001', repeat('a', 64),
    'agent-rover', 'Agent Rover', 'A Robot created through governed agent work.',
    'Robot teams', 'private', '{"goal":"learn"}'::jsonb,
    '{"catalog_revision":"test-agent","robot_check":[]}'::jsonb,
    'test-agent', 'Agent-created first version'
  );
  replayed_create := app.agent_create_robot_with_receipt(
    current_setting('test.robot_agent_id')::uuid,
    current_setting('test.robot_token_id')::uuid,
    '20000000-0000-4000-8000-000000000019',
    '30000000-0000-4000-8000-000000000019',
    'robot-agent-create-0001', repeat('a', 64),
    'agent-rover', 'Agent Rover', 'A Robot created through governed agent work.',
    'Robot teams', 'private', '{"goal":"learn"}'::jsonb,
    '{"catalog_revision":"test-agent","robot_check":[]}'::jsonb,
    'test-agent', 'Agent-created first version'
  );
  if coalesce((first_create->>'replayed')::boolean, true)
    or not coalesce((replayed_create->>'replayed')::boolean, false)
    or first_create->'result'->>'robot_id' <> replayed_create->'result'->>'robot_id' then
    raise exception 'Robot agent creation was not transactionally idempotent';
  end if;

  created_robot_id := (first_create->'result'->>'robot_id')::uuid;
  first_version := app.agent_create_robot_version_with_receipt(
    current_setting('test.robot_agent_id')::uuid,
    current_setting('test.robot_token_id')::uuid,
    '20000000-0000-4000-8000-000000000019',
    '30000000-0000-4000-8000-000000000019',
    'robot-agent-version-0001', repeat('b', 64), created_robot_id,
    '{"goal":"explore"}'::jsonb,
    '{"catalog_revision":"test-agent-2","robot_check":[]}'::jsonb,
    'test-agent-2', 'Agent-created second version'
  );
  replayed_version := app.agent_create_robot_version_with_receipt(
    current_setting('test.robot_agent_id')::uuid,
    current_setting('test.robot_token_id')::uuid,
    '20000000-0000-4000-8000-000000000019',
    '30000000-0000-4000-8000-000000000019',
    'robot-agent-version-0001', repeat('b', 64), created_robot_id,
    '{"goal":"explore"}'::jsonb,
    '{"catalog_revision":"test-agent-2","robot_check":[]}'::jsonb,
    'test-agent-2', 'Agent-created second version'
  );
  if coalesce((first_version->>'replayed')::boolean, true)
    or not coalesce((replayed_version->>'replayed')::boolean, false)
    or first_version->'result'->>'version_id' <> replayed_version->'result'->>'version_id'
    or (select count(*) from app.robot_versions where robot_id = created_robot_id) <> 2
    or (select count(*) from app.agent_action_receipts where agent_identity_id = current_setting('test.robot_agent_id')::uuid and action like 'robot.%') <> 2 then
    raise exception 'Robot agent version or immutable receipts were not transactionally idempotent';
  end if;
end $$;

insert into app.robot_hardware (owner_profile_id, component_slug, quantity, created_by_profile_id)
values ('20000000-0000-4000-8000-000000000019', 'raspberry-pi-5', 1, '20000000-0000-4000-8000-000000000019');

insert into app.robot_component_claims (organization_id, component_slug, proposed_changes, source_urls, submitted_by_profile_id)
values ('30000000-0000-4000-8000-000000000019', 'raspberry-pi-5', '{"fact":"proposal"}', '["https://example.com/source"]', '20000000-0000-4000-8000-000000000019');

select app.record_robot_discovery('mcp', 'component', 'raspberry-pi-5');
select app.record_robot_discovery('a2a', 'component', 'raspberry-pi-5');

do $$ begin
  if (select count(*) from app.robot_versions where robot_id = current_setting('test.private_robot_id')::uuid) <> 2 then raise exception 'Robot version count mismatch'; end if;
  if (select events from app.robot_discovery_daily where channel = 'mcp' and resource_type = 'component' and resource_key = 'raspberry-pi-5') <> 1 then raise exception 'Robot discovery aggregate mismatch'; end if;
  if not exists (select 1 from app.robots where id = current_setting('test.public_robot_id')::uuid and visibility = 'public') then raise exception 'public Robot missing'; end if;
end $$;

rollback;
