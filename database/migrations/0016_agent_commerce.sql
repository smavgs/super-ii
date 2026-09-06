begin;

create table if not exists app.commerce_delegations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete restrict,
  agent_identity_id uuid references app.agent_identities(id) on delete set null,
  created_by_profile_id uuid not null references app.profiles(id) on delete restrict,
  token_prefix text not null check (token_prefix ~ '^sii_commerce_[a-z0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 3
    and scopes <@ array[
      'commerce:orders:create',
      'commerce:orders:read',
      'commerce:receipts:read'
    ]::text[]
  ),
  allowed_products text[] not null check (
    cardinality(allowed_products) between 1 and 8
    and allowed_products <@ array[
      'plan.pro.30d',
      'plan.pro.12m',
      'plan.team.30d',
      'plan.team.12m',
      'highlight.24h',
      'highlight.30d',
      'recognition.founding200',
      'enterprise.quote'
    ]::text[]
  ),
  organization_id uuid references app.organizations(id) on delete cascade,
  repository_id uuid references app.repositories(id) on delete cascade,
  max_order_amount_cents integer not null check (
    max_order_amount_cents between 1 and 100000000
  ),
  total_limit_cents integer not null check (
    total_limit_cents between 1 and 100000000
  ),
  authorized_amount_cents integer not null default 0 check (
    authorized_amount_cents between 0 and total_limit_cents
  ),
  max_orders integer not null default 1 check (max_orders between 1 and 1000),
  orders_created integer not null default 0 check (
    orders_created between 0 and max_orders
  ),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_delegations_creator check (profile_id = created_by_profile_id),
  constraint commerce_delegations_single_target check (
    organization_id is null or repository_id is null
  ),
  constraint commerce_delegations_limits check (
    max_order_amount_cents <= total_limit_cents
  ),
  constraint commerce_delegations_bounded_expiry check (
    expires_at > created_at
    and expires_at <= created_at + interval '30 days'
  )
);
create index if not exists commerce_delegations_active_idx
  on app.commerce_delegations (token_hash, expires_at)
  where revoked_at is null;
create index if not exists commerce_delegations_profile_idx
  on app.commerce_delegations (profile_id, created_at desc);

create table if not exists app.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references app.commerce_delegations(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  agent_identity_id uuid references app.agent_identities(id) on delete set null,
  product_id text not null check (product_id in (
    'plan.pro.30d',
    'plan.pro.12m',
    'plan.team.30d',
    'plan.team.12m',
    'highlight.24h',
    'highlight.30d',
    'recognition.founding200'
  )),
  idempotency_key text not null check (
    char_length(idempotency_key) between 16 and 200
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
  ),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  order_type text not null check (order_type in ('plan', 'participation')),
  payment_order_id uuid unique references app.payment_orders(id) on delete restrict,
  participation_order_id uuid unique references app.participation_orders(id) on delete restrict,
  organization_id uuid references app.organizations(id) on delete restrict,
  repository_id uuid references app.repositories(id) on delete restrict,
  unit_count integer not null default 1 check (unit_count between 1 and 100),
  price_amount_cents integer not null check (price_amount_cents > 0),
  price_currency text not null default 'usd' check (price_currency = 'usd'),
  pay_currency text not null default 'usdc' check (pay_currency = 'usdc'),
  pay_network text not null default 'eth' check (pay_network = 'eth'),
  provider_create_state text not null default 'pending' check (
    provider_create_state in ('pending', 'creating', 'ready', 'failed')
  ),
  provider_create_attempts integer not null default 0 check (
    provider_create_attempts between 0 and 3
  ),
  provider_error_code text check (
    provider_error_code is null or char_length(provider_error_code) <= 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delegation_id, idempotency_key),
  constraint commerce_orders_underlying_shape check (
    (order_type = 'plan' and payment_order_id is not null and participation_order_id is null)
    or
    (order_type = 'participation' and payment_order_id is null and participation_order_id is not null)
  ),
  constraint commerce_orders_product_shape check (
    (product_id = 'plan.pro.30d' and order_type = 'plan'
      and organization_id is null and repository_id is null
      and unit_count = 1 and price_amount_cents = 900)
    or
    (product_id = 'plan.pro.12m' and order_type = 'plan'
      and organization_id is null and repository_id is null
      and unit_count = 1 and price_amount_cents = 8640)
    or
    (product_id = 'plan.team.30d' and order_type = 'plan'
      and organization_id is not null and repository_id is null
      and price_amount_cents = 2000 * unit_count)
    or
    (product_id = 'plan.team.12m' and order_type = 'plan'
      and organization_id is not null and repository_id is null
      and price_amount_cents = 19200 * unit_count)
    or
    (product_id = 'highlight.24h' and order_type = 'participation'
      and organization_id is null and repository_id is not null
      and unit_count = 1 and price_amount_cents = 100)
    or
    (product_id = 'highlight.30d' and order_type = 'participation'
      and organization_id is null and repository_id is not null
      and unit_count = 1 and price_amount_cents = 1500)
    or
    (product_id = 'recognition.founding200' and order_type = 'participation'
      and organization_id is null and repository_id is null
      and unit_count = 1 and price_amount_cents = 20000)
  )
);
create index if not exists commerce_orders_delegation_created_idx
  on app.commerce_orders (delegation_id, created_at desc);
create index if not exists commerce_orders_profile_created_idx
  on app.commerce_orders (profile_id, created_at desc);

create table if not exists app.commerce_receipts (
  id uuid primary key default gen_random_uuid(),
  commerce_order_id uuid not null unique references app.commerce_orders(id) on delete restrict,
  delegation_id uuid not null references app.commerce_delegations(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  agent_identity_id uuid references app.agent_identities(id) on delete set null,
  product_id text not null,
  organization_id uuid references app.organizations(id) on delete restrict,
  repository_id uuid references app.repositories(id) on delete restrict,
  unit_count integer not null,
  price_amount_cents integer not null,
  price_currency text not null check (price_currency = 'usd'),
  pay_currency text not null check (pay_currency = 'usdc'),
  pay_network text not null check (pay_network = 'eth'),
  provider text not null check (provider = 'nowpayments'),
  provider_payment_id text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  payment_finished_at timestamptz not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists commerce_receipts_delegation_idx
  on app.commerce_receipts (delegation_id, created_at desc);
create index if not exists commerce_receipts_profile_idx
  on app.commerce_receipts (profile_id, created_at desc);

create table if not exists app.commerce_quote_requests (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null references app.commerce_delegations(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  agent_identity_id uuid references app.agent_identities(id) on delete set null,
  idempotency_key text not null check (
    char_length(idempotency_key) between 16 and 200
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
  ),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  contact_submission_id uuid not null references app.contact_submissions(id) on delete restrict,
  contact_name text not null check (char_length(contact_name) between 2 and 100),
  contact_email text not null check (char_length(contact_email) between 3 and 254),
  organization_name text not null check (char_length(organization_name) between 2 and 200),
  requirements text not null check (char_length(requirements) between 10 and 4000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'quoted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delegation_id, idempotency_key)
);
create index if not exists commerce_quote_requests_profile_idx
  on app.commerce_quote_requests (profile_id, created_at desc);

create or replace function app.create_commerce_delegation(
  p_profile_id uuid,
  p_agent_identity_id uuid,
  p_token_prefix text,
  p_token_hash text,
  p_scopes text[],
  p_allowed_products text[],
  p_organization_id uuid,
  p_repository_id uuid,
  p_max_order_amount_cents integer,
  p_total_limit_cents integer,
  p_max_orders integer,
  p_expires_at timestamptz
)
returns app.commerce_delegations
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  created app.commerce_delegations;
begin
  if p_agent_identity_id is not null and not exists (
    select 1
    from app.agent_identities identity
    join app.organization_members member
      on member.organization_id = identity.organization_id
      and member.profile_id = p_profile_id
      and member.role in ('owner', 'admin')
    where identity.id = p_agent_identity_id and identity.status = 'active'
  ) then
    raise exception 'commerce_agent_operator_required' using errcode = '42501';
  end if;
  if p_organization_id is not null and not exists (
    select 1 from app.organization_members member
    where member.organization_id = p_organization_id
      and member.profile_id = p_profile_id
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'commerce_organization_operator_required' using errcode = '42501';
  end if;
  if p_repository_id is not null and not exists (
    select 1 from app.repositories repository
    where repository.id = p_repository_id
      and (
        repository.owner_profile_id = p_profile_id
        or exists (
          select 1 from app.organization_members member
          where member.organization_id = repository.owner_organization_id
            and member.profile_id = p_profile_id
            and member.role in ('owner', 'admin', 'maintainer')
        )
      )
  ) then
    raise exception 'commerce_repository_operator_required' using errcode = '42501';
  end if;

  insert into app.commerce_delegations (
    profile_id, agent_identity_id, created_by_profile_id,
    token_prefix, token_hash, scopes, allowed_products,
    organization_id, repository_id, max_order_amount_cents,
    total_limit_cents, max_orders, expires_at
  ) values (
    p_profile_id, p_agent_identity_id, p_profile_id,
    p_token_prefix, p_token_hash, p_scopes, p_allowed_products,
    p_organization_id, p_repository_id, p_max_order_amount_cents,
    p_total_limit_cents, p_max_orders, p_expires_at
  ) returning * into created;
  return created;
end;
$$;

create or replace function app.create_agent_commerce_order(
  p_token_hash text,
  p_idempotency_key text,
  p_request_sha256 text,
  p_product_id text,
  p_organization_id uuid,
  p_repository_id uuid,
  p_unit_count integer,
  p_price_amount_cents integer
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  delegation app.commerce_delegations;
  existing app.commerce_orders;
  created app.commerce_orders;
  payment app.payment_orders;
  participation app.participation_orders;
  selected_slot integer;
  duration_days integer;
  plan_id text;
  billing_term text;
  unit_price integer;
  expected_price integer;
  member_count integer;
  repository_owner_organization_id uuid;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_product_id not in (
      'plan.pro.30d', 'plan.pro.12m', 'plan.team.30d', 'plan.team.12m',
      'highlight.24h', 'highlight.30d', 'recognition.founding200'
    )
    or p_unit_count not between 1 and 100 then
    raise exception 'commerce_order_invalid' using errcode = '22023';
  end if;

  select * into delegation
  from app.commerce_delegations
  where token_hash = p_token_hash
  for update;
  if not found
    or delegation.revoked_at is not null
    or delegation.expires_at <= now()
    or not ('commerce:orders:create' = any(delegation.scopes)) then
    raise exception 'commerce_delegation_unauthorized' using errcode = '42501';
  end if;

  select * into existing
  from app.commerce_orders
  where delegation_id = delegation.id
    and idempotency_key = p_idempotency_key;
  if found then
    if existing.request_sha256 <> p_request_sha256 then
      raise exception 'commerce_idempotency_conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('order', to_jsonb(existing), 'replayed', true);
  end if;

  if not (p_product_id = any(delegation.allowed_products)) then
    raise exception 'commerce_product_not_delegated' using errcode = '42501';
  end if;
  if delegation.repository_id is not null
    and (p_product_id not like 'highlight.%' or p_repository_id is distinct from delegation.repository_id) then
    raise exception 'commerce_repository_boundary_mismatch' using errcode = '42501';
  end if;

  if p_product_id like 'plan.pro.%' then
    if p_organization_id is not null or p_repository_id is not null
      or p_unit_count <> 1 or delegation.organization_id is not null then
      raise exception 'commerce_personal_target_required' using errcode = '22023';
    end if;
    plan_id := 'pro';
    billing_term := case when p_product_id = 'plan.pro.12m' then '12_months' else '30_days' end;
    select monthly_price_cents into unit_price from app.plans
    where id = plan_id and status = 'available';
    expected_price := case when billing_term = '12_months'
      then round((unit_price * 12)::numeric * 0.80)::integer
      else unit_price end;
    if unit_price is null or p_price_amount_cents <> expected_price then
      raise exception 'commerce_price_mismatch' using errcode = '22023';
    end if;
    insert into app.payment_orders (
      profile_id, organization_id, plan_id, seat_count, billing_term,
      price_amount_cents
    ) values (
      delegation.profile_id, null, plan_id, 1, billing_term,
      p_price_amount_cents
    ) returning * into payment;

  elsif p_product_id like 'plan.team.%' then
    if p_organization_id is null or p_repository_id is not null then
      raise exception 'commerce_team_organization_required' using errcode = '22023';
    end if;
    if delegation.organization_id is not null
      and delegation.organization_id <> p_organization_id then
      raise exception 'commerce_organization_boundary_mismatch' using errcode = '42501';
    end if;
    if not exists (
      select 1 from app.organization_members manager
      where manager.organization_id = p_organization_id
        and manager.profile_id = delegation.profile_id
        and manager.role in ('owner', 'admin')
    ) then
      raise exception 'organization_billing_access_required' using errcode = '42501';
    end if;
    select count(*)::integer into member_count
    from app.organization_members member
    where member.organization_id = p_organization_id;
    if p_unit_count < member_count then
      raise exception 'insufficient_team_seats' using errcode = '22023';
    end if;
    plan_id := 'team';
    billing_term := case when p_product_id = 'plan.team.12m' then '12_months' else '30_days' end;
    select monthly_price_cents into unit_price from app.plans
    where id = plan_id and status = 'available';
    expected_price := case when billing_term = '12_months'
      then round((unit_price * p_unit_count * 12)::numeric * 0.80)::integer
      else unit_price * p_unit_count end;
    if unit_price is null or p_price_amount_cents <> expected_price then
      raise exception 'commerce_price_mismatch' using errcode = '22023';
    end if;
    insert into app.payment_orders (
      profile_id, organization_id, plan_id, seat_count, billing_term,
      price_amount_cents
    ) values (
      delegation.profile_id, p_organization_id, plan_id, p_unit_count,
      billing_term, p_price_amount_cents
    ) returning * into payment;

  elsif p_product_id like 'highlight.%' then
    if p_organization_id is not null or p_repository_id is null
      or p_unit_count <> 1 then
      raise exception 'commerce_highlight_repository_required' using errcode = '22023';
    end if;
    duration_days := case when p_product_id = 'highlight.24h' then 1 else 30 end;
    expected_price := case when duration_days = 1 then 100 else 1500 end;
    if p_price_amount_cents <> expected_price then
      raise exception 'commerce_price_mismatch' using errcode = '22023';
    end if;
    select repository.owner_organization_id into repository_owner_organization_id
    from app.repositories repository
    join app.repository_branches branch
      on branch.repository_id = repository.id and branch.is_default
    join app.repository_revisions revision
      on revision.id = branch.head_revision_id and revision.status = 'published'
    where repository.id = p_repository_id
      and repository.visibility = 'public'
      and repository.status = 'published'
      and (
        repository.owner_profile_id = delegation.profile_id
        or exists (
          select 1 from app.organization_members member
          where member.organization_id = repository.owner_organization_id
            and member.profile_id = delegation.profile_id
            and member.role in ('owner', 'admin', 'maintainer')
        )
      );
    if not found then
      raise exception 'reviewed_public_repository_ownership_required' using errcode = '42501';
    end if;
    if delegation.organization_id is not null
      and repository_owner_organization_id is distinct from delegation.organization_id then
      raise exception 'commerce_organization_boundary_mismatch' using errcode = '42501';
    end if;
    insert into app.participation_orders (
      profile_id, product_type, repository_id, duration_days, price_amount_cents
    ) values (
      delegation.profile_id, 'highlight', p_repository_id,
      duration_days, p_price_amount_cents
    ) returning * into participation;
    insert into app.highlight_campaigns (
      order_id, profile_id, repository_id, duration_days
    ) values (
      participation.id, delegation.profile_id, p_repository_id, duration_days
    );

  else
    if p_organization_id is not null or p_repository_id is not null
      or p_unit_count <> 1 or delegation.organization_id is not null then
      raise exception 'commerce_personal_target_required' using errcode = '22023';
    end if;
    if p_price_amount_cents <> 20000 then
      raise exception 'commerce_price_mismatch' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('superii-founding-200', 0));
    update app.fame_slots slot set
      profile_id = null, order_id = null, status = 'open',
      reserved_until = null, updated_at = now()
    from app.participation_orders prior
    where slot.order_id = prior.id and slot.status = 'reserved'
      and (slot.reserved_until <= now() or prior.status in ('failed', 'refunded', 'expired'));
    if exists (
      select 1 from app.fame_slots
      where profile_id = delegation.profile_id
        and status in ('reserved', 'active', 'retired')
    ) then
      raise exception 'fame_membership_already_assigned' using errcode = '23505';
    end if;
    select slot.slot_number into selected_slot
    from app.fame_slots slot where slot.status = 'open'
    order by slot.slot_number for update skip locked limit 1;
    if selected_slot is null then
      raise exception 'fame_founders_closed' using errcode = 'P0001';
    end if;
    insert into app.participation_orders (
      profile_id, product_type, price_amount_cents
    ) values (
      delegation.profile_id, 'fame', p_price_amount_cents
    ) returning * into participation;
    update app.fame_slots set
      profile_id = delegation.profile_id,
      order_id = participation.id,
      status = 'reserved',
      reserved_until = now() + interval '2 hours',
      updated_at = now()
    where slot_number = selected_slot;
  end if;

  if p_price_amount_cents > delegation.max_order_amount_cents
    or delegation.authorized_amount_cents + p_price_amount_cents > delegation.total_limit_cents
    or delegation.orders_created >= delegation.max_orders then
    raise exception 'commerce_delegation_limit_exceeded' using errcode = '42501';
  end if;

  insert into app.commerce_orders (
    delegation_id, profile_id, agent_identity_id, product_id,
    idempotency_key, request_sha256, order_type,
    payment_order_id, participation_order_id, organization_id,
    repository_id, unit_count, price_amount_cents
  ) values (
    delegation.id, delegation.profile_id, delegation.agent_identity_id,
    p_product_id, p_idempotency_key, p_request_sha256,
    case when payment.id is not null then 'plan' else 'participation' end,
    payment.id, participation.id, p_organization_id, p_repository_id,
    p_unit_count, p_price_amount_cents
  ) returning * into created;

  update app.commerce_delegations set
    authorized_amount_cents = authorized_amount_cents + p_price_amount_cents,
    orders_created = orders_created + 1,
    last_used_at = now(),
    updated_at = now()
  where id = delegation.id;

  return jsonb_build_object('order', to_jsonb(created), 'replayed', false);
end;
$$;

create or replace function app.create_commerce_quote_request(
  p_token_hash text,
  p_idempotency_key text,
  p_request_sha256 text,
  p_contact_name text,
  p_contact_email text,
  p_organization_name text,
  p_requirements text,
  p_network_hash text,
  p_user_agent text
)
returns jsonb
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  delegation app.commerce_delegations;
  existing app.commerce_quote_requests;
  submission_id uuid;
  created app.commerce_quote_requests;
  message text;
begin
  select * into delegation
  from app.commerce_delegations
  where token_hash = p_token_hash
  for update;
  if not found
    or delegation.revoked_at is not null
    or delegation.expires_at <= now()
    or not ('commerce:orders:create' = any(delegation.scopes))
    or not ('enterprise.quote' = any(delegation.allowed_products))
    or delegation.organization_id is not null
    or delegation.repository_id is not null then
    raise exception 'commerce_quote_unauthorized' using errcode = '42501';
  end if;
  select * into existing from app.commerce_quote_requests
  where delegation_id = delegation.id and idempotency_key = p_idempotency_key;
  if found then
    if existing.request_sha256 <> p_request_sha256 then
      raise exception 'commerce_idempotency_conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('quote_request', to_jsonb(existing), 'replayed', true);
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_network_hash !~ '^[a-f0-9]{64}$'
    or char_length(trim(p_contact_name)) not between 2 and 100
    or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(trim(p_organization_name)) not between 2 and 200
    or char_length(trim(p_requirements)) not between 10 and 4000 then
    raise exception 'commerce_quote_invalid' using errcode = '22023';
  end if;
  message := left(
    'Organization: ' || trim(p_organization_name) || E'\n\n'
      || trim(p_requirements),
    4000
  );
  submission_id := app.submit_contact(
    trim(p_contact_name), lower(trim(p_contact_email)), 'enterprise',
    message, p_network_hash, left(coalesce(p_user_agent, ''), 500)
  );
  insert into app.waitlist (email, interest, source)
  values (lower(trim(p_contact_email)), 'enterprise', 'agent-commerce')
  on conflict (email, interest) do update set updated_at = now();
  insert into app.commerce_quote_requests (
    delegation_id, profile_id, agent_identity_id, idempotency_key,
    request_sha256, contact_submission_id, contact_name, contact_email,
    organization_name, requirements
  ) values (
    delegation.id, delegation.profile_id, delegation.agent_identity_id,
    p_idempotency_key, p_request_sha256, submission_id,
    trim(p_contact_name), lower(trim(p_contact_email)),
    trim(p_organization_name), trim(p_requirements)
  ) returning * into created;
  update app.commerce_delegations set last_used_at = now(), updated_at = now()
  where id = delegation.id;
  return jsonb_build_object('quote_request', to_jsonb(created), 'replayed', false);
end;
$$;

create or replace function app.capture_commerce_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  commerce app.commerce_orders;
  evidence jsonb;
  evidence_hash text;
  created_receipt app.commerce_receipts;
begin
  if tg_table_name = 'payment_orders' then
    select * into commerce from app.commerce_orders
    where payment_order_id = new.id;
  else
    select * into commerce from app.commerce_orders
    where participation_order_id = new.id;
  end if;
  if commerce.id is null then return new; end if;

  if new.provider_payment_id is not null then
    update app.commerce_orders set
      provider_create_state = 'ready', provider_error_code = null,
      updated_at = now()
    where id = commerce.id and provider_create_state <> 'ready';
  end if;

  if new.status = 'finished' and old.status is distinct from 'finished' then
    evidence := jsonb_build_object(
      'commerce_order_id', commerce.id,
      'product_id', commerce.product_id,
      'profile_id', commerce.profile_id,
      'organization_id', commerce.organization_id,
      'repository_id', commerce.repository_id,
      'unit_count', commerce.unit_count,
      'price_amount_cents', commerce.price_amount_cents,
      'price_currency', commerce.price_currency,
      'pay_currency', commerce.pay_currency,
      'pay_network', commerce.pay_network,
      'provider', new.provider,
      'provider_payment_id', new.provider_payment_id,
      'payment_finished_at', coalesce(new.paid_at, now())
    );
    evidence_hash := encode(
      public.digest(convert_to(evidence::text, 'UTF8'), 'sha256'), 'hex'
    );
    insert into app.commerce_receipts (
      commerce_order_id, delegation_id, profile_id, agent_identity_id,
      product_id, organization_id, repository_id, unit_count,
      price_amount_cents, price_currency, pay_currency, pay_network,
      provider, provider_payment_id, evidence_sha256,
      payment_finished_at, detail
    ) values (
      commerce.id, commerce.delegation_id, commerce.profile_id,
      commerce.agent_identity_id, commerce.product_id,
      commerce.organization_id, commerce.repository_id, commerce.unit_count,
      commerce.price_amount_cents, commerce.price_currency,
      commerce.pay_currency, commerce.pay_network, new.provider,
      new.provider_payment_id, evidence_hash, coalesce(new.paid_at, now()),
      evidence
    ) on conflict (commerce_order_id) do nothing
    returning * into created_receipt;

    if created_receipt.id is not null and commerce.agent_identity_id is not null then
      insert into app.agent_events (
        organization_id, repository_id, agent_identity_id,
        event_type, visibility, payload
      )
      select identity.organization_id, commerce.repository_id,
             commerce.agent_identity_id, 'commerce.payment-finished',
             'operator', jsonb_build_object(
               'commerce_order_id', commerce.id,
               'receipt_id', created_receipt.id,
               'product_id', commerce.product_id,
               'price_amount_cents', commerce.price_amount_cents,
               'pay_currency', commerce.pay_currency,
               'pay_network', commerce.pay_network
             )
      from app.agent_identities identity
      where identity.id = commerce.agent_identity_id;
    end if;
  elsif new.status = 'refunded' and old.status is distinct from 'refunded'
    and commerce.agent_identity_id is not null then
    insert into app.agent_events (
      organization_id, repository_id, agent_identity_id,
      event_type, visibility, payload
    )
    select identity.organization_id, commerce.repository_id,
           commerce.agent_identity_id, 'commerce.payment-refunded',
           'operator', jsonb_build_object(
             'commerce_order_id', commerce.id,
             'product_id', commerce.product_id
           )
    from app.agent_identities identity
    where identity.id = commerce.agent_identity_id;
  end if;
  return new;
end;
$$;

create or replace function app.prevent_commerce_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  raise exception 'commerce_receipt_is_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists commerce_plan_payment_status on app.payment_orders;
create trigger commerce_plan_payment_status
after update of status, provider_payment_id on app.payment_orders
for each row execute function app.capture_commerce_payment_status();

drop trigger if exists commerce_participation_payment_status on app.participation_orders;
create trigger commerce_participation_payment_status
after update of status, provider_payment_id on app.participation_orders
for each row execute function app.capture_commerce_payment_status();

drop trigger if exists commerce_receipts_immutable on app.commerce_receipts;
create trigger commerce_receipts_immutable
before update or delete on app.commerce_receipts
for each row execute function app.prevent_commerce_receipt_mutation();

drop trigger if exists commerce_delegations_touch_updated_at on app.commerce_delegations;
create trigger commerce_delegations_touch_updated_at
before update on app.commerce_delegations
for each row execute function app.touch_updated_at();

drop trigger if exists commerce_orders_touch_updated_at on app.commerce_orders;
create trigger commerce_orders_touch_updated_at
before update on app.commerce_orders
for each row execute function app.touch_updated_at();

drop trigger if exists commerce_quote_requests_touch_updated_at on app.commerce_quote_requests;
create trigger commerce_quote_requests_touch_updated_at
before update on app.commerce_quote_requests
for each row execute function app.touch_updated_at();

alter table app.commerce_delegations enable row level security;
alter table app.commerce_orders enable row level security;
alter table app.commerce_receipts enable row level security;
alter table app.commerce_quote_requests enable row level security;

commit;
