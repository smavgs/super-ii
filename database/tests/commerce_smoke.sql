\set ON_ERROR_STOP on

begin;

do $$
declare
  buyer_id uuid;
  member_id uuid;
  organization_id uuid;
  repository_result record;
  main_delegation app.commerce_delegations;
  limited_delegation app.commerce_delegations;
  bounded_delegation app.commerce_delegations;
  outcome jsonb;
  pro_commerce_order_id uuid;
  pro_payment_order_id uuid;
  founding_commerce_order_id uuid;
  founding_payment_order_id uuid;
  quote_request_id uuid;
  receipt_id uuid;
  receipt_hash text;
  period_end timestamptz;
  payment_order_count integer;
begin
  buyer_id := app.ensure_profile(
    'commerce-buyer', 'commerce-buyer', 'Commerce Buyer', null
  );
  member_id := app.ensure_profile(
    'commerce-member', 'commerce-member', 'Commerce Member', null
  );

  insert into app.organizations (handle, name, full_name, organization_type)
  values ('commerce-team', 'Commerce Team', 'Commerce Team', 'company')
  returning id into organization_id;
  insert into app.organization_members (organization_id, profile_id, role)
  values
    (organization_id, buyer_id, 'owner'),
    (organization_id, member_id, 'member');

  select * into repository_result from app.create_repository_with_revision(
    buyer_id, null, 'model', 'commerce-highlight', 'Commerce Highlight Model',
    'A reviewed public repository used by the agent commerce integration test.',
    'apache-2.0', 'text-generation', 'test', 'text',
    '# Model Card', '{"origin":"commerce-integration-test"}'::jsonb
  );
  update app.repository_revisions set
    manifest_sha256 = repeat('a', 64),
    commit_sha = repeat('b', 64),
    status = 'published',
    published_at = now()
  where id = repository_result.revision_id;
  update app.repositories set
    status = 'published', published_at = now(),
    latest_revision_id = repository_result.revision_id
  where id = repository_result.repository_id;

  main_delegation := app.create_commerce_delegation(
    buyer_id, null, 'sii_commerce_main0001', repeat('1', 64),
    array[
      'commerce:orders:create',
      'commerce:orders:read',
      'commerce:receipts:read'
    ],
    array[
      'plan.pro.30d',
      'plan.team.12m',
      'highlight.24h',
      'recognition.founding200',
      'enterprise.quote'
    ],
    null, null, 50000, 100000, 6, now() + interval '1 day'
  );

  outcome := app.create_agent_commerce_order(
    repeat('1', 64), 'commerce-pro-0001', repeat('c', 64),
    'plan.pro.30d', null, null, 1, 900
  );
  if (outcome->>'replayed')::boolean
    or outcome->'order'->>'product_id' <> 'plan.pro.30d'
    or (outcome->'order'->>'price_amount_cents')::integer <> 900 then
    raise exception 'Pro commerce order did not preserve the exact catalog contract';
  end if;
  pro_commerce_order_id := (outcome->'order'->>'id')::uuid;
  pro_payment_order_id := (outcome->'order'->>'payment_order_id')::uuid;

  outcome := app.create_agent_commerce_order(
    repeat('1', 64), 'commerce-pro-0001', repeat('c', 64),
    'plan.pro.30d', null, null, 1, 900
  );
  if not (outcome->>'replayed')::boolean
    or (outcome->'order'->>'id')::uuid <> pro_commerce_order_id then
    raise exception 'Exact commerce idempotency replay failed';
  end if;
  if (select orders_created from app.commerce_delegations where id = main_delegation.id) <> 1
    or (select authorized_amount_cents from app.commerce_delegations where id = main_delegation.id) <> 900 then
    raise exception 'Idempotent replay consumed commerce authority twice';
  end if;
  begin
    perform app.create_agent_commerce_order(
      repeat('1', 64), 'commerce-pro-0001', repeat('d', 64),
      'plan.pro.30d', null, null, 1, 900
    );
    raise exception 'Changed request reused an idempotency key';
  exception when serialization_failure then
    null;
  end;

  begin
    perform app.create_agent_commerce_order(
      repeat('1', 64), 'commerce-team-bad1', repeat('e', 64),
      'plan.team.12m', organization_id, null, 1, 19200
    );
    raise exception 'Team commerce accepted fewer seats than current membership';
  exception when invalid_parameter_value then
    null;
  end;
  outcome := app.create_agent_commerce_order(
    repeat('1', 64), 'commerce-team-0001', repeat('f', 64),
    'plan.team.12m', organization_id, null, 2, 38400
  );
  if (outcome->'order'->>'organization_id')::uuid <> organization_id
    or (outcome->'order'->>'unit_count')::integer <> 2
    or (outcome->'order'->>'price_amount_cents')::integer <> 38400 then
    raise exception 'Team commerce did not preserve organization, seats, or annual price';
  end if;

  outcome := app.create_agent_commerce_order(
    repeat('1', 64), 'commerce-highlight1', repeat('0', 64),
    'highlight.24h', null, repository_result.repository_id, 1, 100
  );
  if (outcome->'order'->>'repository_id')::uuid <> repository_result.repository_id
    or not exists (
      select 1 from app.highlight_campaigns
      where order_id = (outcome->'order'->>'participation_order_id')::uuid
        and state = 'pending' and duration_days = 1
    ) then
    raise exception 'Highlight commerce did not create its exact pending campaign';
  end if;

  outcome := app.create_agent_commerce_order(
    repeat('1', 64), 'commerce-founding01', repeat('2', 64),
    'recognition.founding200', null, null, 1, 20000
  );
  founding_commerce_order_id := (outcome->'order'->>'id')::uuid;
  founding_payment_order_id := (outcome->'order'->>'participation_order_id')::uuid;
  if not exists (
    select 1 from app.fame_slots
    where order_id = founding_payment_order_id and slot_number = 1
      and status = 'reserved'
  ) then
    raise exception 'Founding 200 commerce did not reserve the next exact place';
  end if;

  if (select orders_created from app.commerce_delegations where id = main_delegation.id) <> 4
    or (select authorized_amount_cents from app.commerce_delegations where id = main_delegation.id) <> 59400 then
    raise exception 'Commerce budget ledger did not account for exact created invoices';
  end if;

  update app.payment_orders set
    provider_payment_id = 'commerce-test-pro-payment',
    pay_amount = 9,
    pay_address = '0x0000000000000000000000000000000000000001',
    status = 'waiting',
    provider_payload = '{"payment_status":"waiting"}'::jsonb
  where id = pro_payment_order_id;
  if (select provider_create_state from app.commerce_orders where id = pro_commerce_order_id) <> 'ready' then
    raise exception 'Provider invoice readiness was not joined to the commerce order';
  end if;
  perform app.apply_nowpayments_status(
    pro_payment_order_id, 'commerce-test-pro-payment', 'finished',
    '{"payment_status":"finished","price_amount":9,"price_currency":"usd","pay_currency":"usdc","network":"eth"}'::jsonb
  );
  select id, evidence_sha256 into receipt_id, receipt_hash
  from app.commerce_receipts where commerce_order_id = pro_commerce_order_id;
  if receipt_id is null or receipt_hash !~ '^[a-f0-9]{64}$'
    or (select count(*) from app.commerce_receipts where commerce_order_id = pro_commerce_order_id) <> 1 then
    raise exception 'Confirmed Pro payment did not create one hash-backed commerce receipt';
  end if;
  select current_period_end into period_end from app.subscriptions
  where provider_subscription_id = 'commerce-test-pro-payment';
  if period_end is null then
    raise exception 'Confirmed Pro commerce payment did not activate its entitlement';
  end if;
  perform app.apply_nowpayments_status(
    pro_payment_order_id, 'commerce-test-pro-payment', 'finished',
    '{"payment_status":"finished"}'::jsonb
  );
  if (select count(*) from app.commerce_receipts where commerce_order_id = pro_commerce_order_id) <> 1
    or (select current_period_end from app.subscriptions where provider_subscription_id = 'commerce-test-pro-payment') <> period_end then
    raise exception 'Replayed payment duplicated a receipt or entitlement';
  end if;
  begin
    update app.commerce_receipts set detail = '{"tampered":true}'::jsonb
    where id = receipt_id;
    raise exception 'Commerce receipt mutation was accepted';
  exception when sqlstate '55000' then
    null;
  end;
  perform app.apply_nowpayments_status(
    pro_payment_order_id, 'commerce-test-pro-payment', 'refunded',
    '{"payment_status":"refunded"}'::jsonb
  );
  if (select count(*) from app.commerce_receipts where id = receipt_id) <> 1
    or (select status from app.subscriptions where provider_subscription_id = 'commerce-test-pro-payment') <> 'canceled' then
    raise exception 'Refund did not revoke access while preserving payment evidence';
  end if;

  update app.participation_orders set
    provider_payment_id = 'commerce-test-founding-payment',
    pay_amount = 200,
    pay_address = '0x0000000000000000000000000000000000000002',
    status = 'waiting',
    provider_payload = '{"payment_status":"waiting"}'::jsonb
  where id = founding_payment_order_id;
  perform app.apply_participation_payment_status(
    founding_payment_order_id, 'commerce-test-founding-payment', 'finished',
    '{"payment_status":"finished","price_amount":200,"price_currency":"usd","pay_currency":"usdc","network":"eth"}'::jsonb
  );
  if not exists (
    select 1 from app.commerce_receipts
    where commerce_order_id = founding_commerce_order_id
      and product_id = 'recognition.founding200'
      and pay_currency = 'usdc' and pay_network = 'eth'
  ) or not exists (
    select 1 from app.fame_slots
    where order_id = founding_payment_order_id and status = 'active'
  ) then
    raise exception 'Founding 200 confirmation did not fulfill and receipt atomically';
  end if;

  outcome := app.create_commerce_quote_request(
    repeat('1', 64), 'commerce-quote-001', repeat('3', 64),
    'Commerce Buyer', 'buyer@example.com', 'Commerce Team',
    'Please prepare an exact Enterprise proposal for our governed deployment.',
    repeat('4', 64), 'commerce-integration-test'
  );
  quote_request_id := (outcome->'quote_request'->>'id')::uuid;
  if (outcome->>'replayed')::boolean or quote_request_id is null
    or not exists (
      select 1 from app.contact_submissions
      where id = (outcome->'quote_request'->>'contact_submission_id')::uuid
        and interest = 'enterprise'
    ) then
    raise exception 'Enterprise agent quote was not stored for human review';
  end if;
  outcome := app.create_commerce_quote_request(
    repeat('1', 64), 'commerce-quote-001', repeat('3', 64),
    'Commerce Buyer', 'buyer@example.com', 'Commerce Team',
    'Please prepare an exact Enterprise proposal for our governed deployment.',
    repeat('4', 64), 'commerce-integration-test'
  );
  if not (outcome->>'replayed')::boolean
    or (outcome->'quote_request'->>'id')::uuid <> quote_request_id then
    raise exception 'Enterprise quote idempotency replay failed';
  end if;

  limited_delegation := app.create_commerce_delegation(
    buyer_id, null, 'sii_commerce_limit001', repeat('5', 64),
    array['commerce:orders:create'], array['plan.pro.30d'],
    null, null, 900, 900, 1, now() + interval '1 day'
  );
  perform app.create_agent_commerce_order(
    repeat('5', 64), 'commerce-limit-001', repeat('6', 64),
    'plan.pro.30d', null, null, 1, 900
  );
  select count(*) into payment_order_count from app.payment_orders
  where profile_id = buyer_id;
  begin
    perform app.create_agent_commerce_order(
      repeat('5', 64), 'commerce-limit-002', repeat('7', 64),
      'plan.pro.30d', null, null, 1, 900
    );
    raise exception 'Commerce delegation order cap was bypassed';
  exception when insufficient_privilege then
    null;
  end;
  if (select count(*) from app.payment_orders where profile_id = buyer_id) <> payment_order_count
    or (select orders_created from app.commerce_delegations where id = limited_delegation.id) <> 1 then
    raise exception 'Rejected over-limit commerce order left partial database state';
  end if;

  bounded_delegation := app.create_commerce_delegation(
    buyer_id, null, 'sii_commerce_bound001', repeat('8', 64),
    array['commerce:orders:create'], array['plan.pro.30d', 'highlight.24h', 'enterprise.quote'],
    null, repository_result.repository_id, 900, 900, 1,
    now() + interval '1 day'
  );
  begin
    perform app.create_agent_commerce_order(
      repeat('8', 64), 'commerce-bound-001', repeat('9', 64),
      'plan.pro.30d', null, null, 1, 900
    );
    raise exception 'Repository-bound commerce token created a personal order';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform app.create_commerce_quote_request(
      repeat('8', 64), 'commerce-bound-quote1', repeat('b', 64),
      'Commerce Buyer', 'buyer@example.com', 'Unrelated Company',
      'Please prepare an Enterprise proposal outside this repository boundary.',
      repeat('c', 64), 'commerce-integration-test'
    );
    raise exception 'Repository-bound commerce token submitted an unbound Enterprise quote';
  exception when insufficient_privilege then
    null;
  end;
  update app.commerce_delegations set revoked_at = now()
  where id = bounded_delegation.id;
  begin
    perform app.create_agent_commerce_order(
      repeat('8', 64), 'commerce-bound-002', repeat('a', 64),
      'highlight.24h', null, repository_result.repository_id, 1, 100
    );
    raise exception 'Revoked commerce token remained usable';
  exception when insufficient_privilege then
    null;
  end;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.agent_access_tokens'::regclass
      and pg_get_constraintdef(oid) like '%spend_limit_cents = 0%'
  ) then
    raise exception 'Existing Work tokens lost their permanent zero-spend boundary';
  end if;
end;
$$;

rollback;
