\set ON_ERROR_STOP on

begin;

do $$
declare
  buyer_id uuid;
  organization_id uuid;
  monthly_order app.payment_orders;
  annual_order app.payment_orders;
  team_annual_order app.payment_orders;
  annual_period_end timestamptz;
begin
  buyer_id := app.ensure_profile(
    'billing-term-buyer', 'billing-term-buyer', 'Billing Term Buyer', null
  );

  insert into app.organizations (handle, name, full_name, organization_type)
  values ('billing-term-team', 'Billing Term Team', 'Billing Term Team', 'company')
  returning id into organization_id;
  insert into app.organization_members (organization_id, profile_id, role)
  values (organization_id, buyer_id, 'owner');

  monthly_order := app.create_or_reuse_payment_order(
    buyer_id, null, 'pro', 1, 900
  );
  if monthly_order.billing_term <> '30_days'
    or monthly_order.price_amount_cents <> 900 then
    raise exception 'legacy monthly checkout did not preserve the 30-day term';
  end if;

  annual_order := app.create_or_reuse_payment_order(
    buyer_id, null, 'pro', 1, 8640, '12_months'
  );
  if annual_order.billing_term <> '12_months'
    or annual_order.price_amount_cents <> 8640
    or annual_order.id = monthly_order.id then
    raise exception 'Pro annual checkout did not preserve its term or 20 percent discount';
  end if;

  team_annual_order := app.create_or_reuse_payment_order(
    buyer_id, organization_id, 'team', 1, 19200, '12_months'
  );
  if team_annual_order.billing_term <> '12_months'
    or team_annual_order.price_amount_cents <> 19200 then
    raise exception 'Team annual checkout did not preserve its term or 20 percent discount';
  end if;

  begin
    perform app.create_or_reuse_payment_order(
      buyer_id, null, 'pro', 1, 8639, '12_months'
    );
    raise exception 'invalid annual price was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  update app.payment_orders
  set provider_payment_id = 'billing-term-annual', status = 'waiting'
  where id = annual_order.id;
  perform app.apply_nowpayments_status(
    annual_order.id,
    'billing-term-annual',
    'finished',
    '{"payment_status":"finished"}'::jsonb
  );

  select current_period_end into annual_period_end
  from app.subscriptions
  where provider_subscription_id = 'billing-term-annual';
  if annual_period_end < now() + interval '11 months 29 days'
    or annual_period_end > now() + interval '12 months 1 day' then
    raise exception 'annual payment did not activate approximately 12 months';
  end if;
  if not exists (
    select 1 from app.notifications
    where profile_id = buyer_id
      and event_type = 'billing.payment_finished'
      and body like '%12 months%'
      and metadata->>'billing_term' = '12_months'
  ) then
    raise exception 'annual activation notification did not preserve the billing term';
  end if;

  perform app.apply_nowpayments_status(
    annual_order.id,
    'billing-term-annual',
    'finished',
    '{"payment_status":"finished"}'::jsonb
  );
  if (select current_period_end from app.subscriptions where provider_subscription_id = 'billing-term-annual')
    <> annual_period_end then
    raise exception 'replayed annual payment extended the entitlement twice';
  end if;
end;
$$;

rollback;
