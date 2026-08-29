begin;

alter table app.subscriptions
  add column if not exists organization_id uuid references app.organizations(id) on delete restrict;

create index if not exists subscriptions_organization_idx
  on app.subscriptions (organization_id);

alter table app.subscriptions drop constraint if exists subscriptions_owner;
alter table app.subscriptions add constraint subscriptions_owner check (
  num_nonnulls(clerk_user_id, clerk_organization_id, organization_id) = 1
);

create or replace function app.create_or_reuse_payment_order(
  p_profile_id uuid,
  p_organization_id uuid,
  p_plan_id text,
  p_seat_count integer,
  p_price_amount_cents integer
)
returns app.payment_orders
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.payment_orders;
  unit_price integer;
  member_count integer;
begin
  if p_plan_id not in ('pro', 'team')
    or p_seat_count < 1 or p_seat_count > 100
    or p_price_amount_cents < 1 then
    raise exception 'invalid_payment_order' using errcode = '22023';
  end if;

  select monthly_price_cents into unit_price
  from app.plans
  where id = p_plan_id and status = 'available';
  if unit_price is null or p_price_amount_cents <> unit_price * p_seat_count then
    raise exception 'invalid_payment_price' using errcode = '22023';
  end if;

  if p_plan_id = 'pro' and (p_organization_id is not null or p_seat_count <> 1) then
    raise exception 'invalid_pro_owner' using errcode = '22023';
  end if;
  if p_plan_id = 'team' then
    if p_organization_id is null or not exists (
      select 1
      from app.organization_members manager
      where manager.organization_id = p_organization_id
        and manager.profile_id = p_profile_id
        and manager.role in ('owner', 'admin')
    ) then
      raise exception 'organization_billing_access_required' using errcode = '42501';
    end if;
    select count(*)::integer into member_count
    from app.organization_members member
    where member.organization_id = p_organization_id;
    if p_seat_count < member_count then
      raise exception 'insufficient_team_seats' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':' || coalesce(p_organization_id::text, 'personal')
      || ':' || p_plan_id || ':' || p_seat_count::text,
    0
  ));
  select * into target
  from app.payment_orders
  where profile_id = p_profile_id
    and organization_id is not distinct from p_organization_id
    and plan_id = p_plan_id
    and seat_count = p_seat_count
    and price_amount_cents = p_price_amount_cents
    and status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
    and created_at > now() - interval '30 minutes'
  order by created_at desc
  limit 1;
  if found then return target; end if;

  insert into app.payment_orders (
    profile_id, organization_id, plan_id, seat_count, price_amount_cents
  ) values (
    p_profile_id, p_organization_id, p_plan_id, p_seat_count, p_price_amount_cents
  ) returning * into target;
  return target;
end;
$$;

create or replace function app.apply_nowpayments_status(
  p_order_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.payment_orders;
  effective_status text;
  period_end timestamptz;
  purchaser_clerk_user_id text;
begin
  if p_status not in ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired') then
    raise exception 'invalid_payment_status' using errcode = '22023';
  end if;

  select * into target from app.payment_orders where id = p_order_id for update;
  if not found or target.provider <> 'nowpayments' then
    raise exception 'payment_order_not_found' using errcode = 'P0002';
  end if;
  if target.provider_payment_id is not null
    and target.provider_payment_id <> p_provider_payment_id then
    raise exception 'payment_id_mismatch' using errcode = '22023';
  end if;

  effective_status := p_status;
  if target.status = 'finished' and p_status <> 'refunded' then
    effective_status := 'finished';
  elsif target.status = 'refunded' then
    effective_status := 'refunded';
  end if;

  update app.payment_orders
  set provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
      status = effective_status,
      provider_payload = coalesce(p_payload, '{}'::jsonb),
      paid_at = case when effective_status = 'finished' then coalesce(paid_at, now()) else paid_at end,
      updated_at = now()
  where id = p_order_id;

  if effective_status = 'finished' and target.status <> 'finished' then
    select p.clerk_user_id into purchaser_clerk_user_id
    from app.profiles p
    where p.id = target.profile_id;

    select greatest(now(), coalesce(max(s.current_period_end), now())) + interval '30 days'
    into period_end
    from app.subscriptions s
    where s.plan_id = target.plan_id
      and s.status = 'active'
      and s.current_period_end > now()
      and (
        (target.organization_id is null and s.clerk_user_id = purchaser_clerk_user_id)
        or (target.organization_id is not null and s.organization_id = target.organization_id)
      );

    insert into app.subscriptions (
      clerk_user_id, clerk_organization_id, organization_id, plan_id, provider,
      provider_subscription_id, status, current_period_end
    ) values (
      case when target.organization_id is null then purchaser_clerk_user_id else null end,
      null,
      target.organization_id,
      target.plan_id,
      'nowpayments',
      p_provider_payment_id,
      'active',
      period_end
    )
    on conflict (provider_subscription_id) do update set
      status = 'active', current_period_end = excluded.current_period_end, updated_at = now();

    insert into app.notifications (profile_id, event_type, title, body, href, metadata)
    values (
      target.profile_id,
      'billing.payment_finished',
      'Your Super ii plan is active 🎉',
      'USDC payment confirmed. Your plan is active for the next 30 days.',
      '/account',
      jsonb_build_object(
        'order_id', p_order_id,
        'plan_id', target.plan_id,
        'organization_id', target.organization_id,
        'seat_count', target.seat_count
      )
    );
  elsif effective_status = 'refunded' and target.status = 'finished' then
    update app.subscriptions
    set status = 'canceled', current_period_end = least(coalesce(current_period_end, now()), now()), updated_at = now()
    where provider = 'nowpayments' and provider_subscription_id = p_provider_payment_id;

    insert into app.notifications (profile_id, event_type, title, body, href, metadata)
    values (
      target.profile_id,
      'billing.payment_refunded',
      'Your refunded plan payment was closed',
      'NOWPayments reported this payment as refunded, so its entitlement is no longer active.',
      '/account',
      jsonb_build_object('order_id', p_order_id, 'plan_id', target.plan_id)
    );
  end if;
  return true;
end;
$$;

commit;
