begin;

create table if not exists app.proposals (
  id uuid primary key default gen_random_uuid(),
  proposer_profile_id uuid not null references app.profiles(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$'),
  title text not null check (char_length(title) between 5 and 160),
  summary text not null check (char_length(summary) between 10 and 360),
  body text not null default '' check (char_length(body) <= 12000),
  status text not null default 'voting'
    check (status in ('voting', 'accepted', 'building', 'shipped', 'removed')),
  acceptance_reason text check (acceptance_reason is null or acceptance_reason in ('human-threshold', 'manual')),
  human_vote_threshold integer not null default 100 check (human_vote_threshold between 1 and 10000),
  agent_vote_threshold integer not null default 1000 check (agent_vote_threshold between 1 and 100000),
  human_threshold_reached_at timestamptz,
  agent_threshold_reached_at timestamptz,
  accepted_at timestamptz,
  building_at timestamptz,
  shipped_at timestamptz,
  removed_at timestamptz,
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proposals_public_status_created_idx
  on app.proposals (status, created_at desc) where status <> 'removed';
create index if not exists proposals_proposer_created_idx
  on app.proposals (proposer_profile_id, created_at desc);

create table if not exists app.proposal_status_history (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references app.proposals(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('voting', 'accepted', 'building', 'shipped', 'removed')),
  changed_by_profile_id uuid references app.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists proposal_status_history_proposal_idx
  on app.proposal_status_history (proposal_id, created_at);

create table if not exists app.proposal_votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references app.proposals(id) on delete cascade,
  vote_kind text not null check (vote_kind in ('human', 'agent')),
  voter_profile_id uuid references app.profiles(id) on delete restrict,
  voter_social_agent_id uuid references app.social_agents(id) on delete restrict,
  operator_profile_id uuid not null references app.profiles(id) on delete restrict,
  network_hash text check (network_hash is null or network_hash ~ '^[a-f0-9]{64}$'),
  risk_state text not null default 'valid' check (risk_state in ('valid', 'flagged', 'removed')),
  risk_reason text check (risk_reason is null or char_length(risk_reason) <= 240),
  reviewed_by_profile_id uuid references app.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint proposal_votes_identity_shape check (
    (vote_kind = 'human'
      and voter_profile_id is not null
      and voter_social_agent_id is null
      and operator_profile_id = voter_profile_id)
    or
    (vote_kind = 'agent'
      and voter_profile_id is null
      and voter_social_agent_id is not null)
  )
);
create unique index if not exists proposal_votes_human_unique_idx
  on app.proposal_votes (proposal_id, voter_profile_id) where vote_kind = 'human';
create unique index if not exists proposal_votes_agent_unique_idx
  on app.proposal_votes (proposal_id, voter_social_agent_id) where vote_kind = 'agent';
create index if not exists proposal_votes_public_count_idx
  on app.proposal_votes (proposal_id, vote_kind, risk_state, created_at);
create index if not exists proposal_votes_network_review_idx
  on app.proposal_votes (network_hash, created_at desc) where vote_kind = 'human';

create table if not exists app.proposal_reports (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references app.proposals(id) on delete cascade,
  vote_id uuid references app.proposal_votes(id) on delete cascade,
  reporter_profile_id uuid not null references app.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'manipulation', 'duplicate', 'unsafe', 'other')),
  detail text not null default '' check (char_length(detail) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  reviewed_by_profile_id uuid references app.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (proposal_id, reporter_profile_id, reason)
);
create index if not exists proposal_reports_review_idx
  on app.proposal_reports (status, created_at);

create table if not exists app.proposal_leader_badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete restrict,
  award_month date not null check (award_month = date_trunc('month', award_month)::date),
  rank smallint not null check (rank between 1 and 3),
  winning_proposal_id uuid not null references app.proposals(id) on delete restrict,
  valid_human_votes integer not null check (valid_human_votes > 0),
  awarded_at timestamptz not null default now(),
  unique (award_month, rank),
  unique (award_month, profile_id)
);
create index if not exists proposal_leader_badges_profile_idx
  on app.proposal_leader_badges (profile_id, award_month desc);

create table if not exists app.participation_orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete restrict,
  product_type text not null check (product_type in ('fame', 'highlight')),
  repository_id uuid references app.repositories(id) on delete restrict,
  duration_days integer,
  provider text not null default 'nowpayments' check (provider = 'nowpayments'),
  provider_payment_id text unique,
  price_amount_cents integer not null check (price_amount_cents > 0),
  price_currency text not null default 'usd' check (price_currency = 'usd'),
  pay_currency text not null default 'usdc' check (pay_currency = 'usdc'),
  pay_network text not null default 'eth' check (pay_network = 'eth'),
  pay_amount numeric(30, 12),
  pay_address text,
  status text not null default 'created' check (
    status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired')
  ),
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participation_orders_product_shape check (
    (product_type = 'fame' and repository_id is null and duration_days is null and price_amount_cents = 20000)
    or
    (product_type = 'highlight' and repository_id is not null
      and duration_days in (1, 30)
      and price_amount_cents = case when duration_days = 1 then 100 else 1500 end)
  )
);
create index if not exists participation_orders_profile_created_idx
  on app.participation_orders (profile_id, created_at desc);
create index if not exists participation_orders_status_created_idx
  on app.participation_orders (status, created_at desc);

create table if not exists app.fame_slots (
  slot_number integer primary key check (slot_number between 1 and 200),
  profile_id uuid unique references app.profiles(id) on delete restrict,
  order_id uuid unique references app.participation_orders(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'reserved', 'active', 'retired')),
  reserved_until timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fame_slots_state_shape check (
    (status = 'open' and profile_id is null and order_id is null and reserved_until is null and activated_at is null)
    or (status = 'reserved' and profile_id is not null and order_id is not null and reserved_until is not null and activated_at is null)
    or (status = 'active' and profile_id is not null and order_id is not null and reserved_until is null and activated_at is not null)
    or (status = 'retired' and profile_id is not null and order_id is not null and activated_at is not null and retired_at is not null)
  )
);
insert into app.fame_slots (slot_number)
select number from generate_series(1, 200) as number
on conflict (slot_number) do nothing;

create table if not exists app.highlight_campaigns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references app.participation_orders(id) on delete restrict,
  profile_id uuid not null references app.profiles(id) on delete restrict,
  repository_id uuid not null references app.repositories(id) on delete restrict,
  duration_days integer not null check (duration_days in (1, 30)),
  state text not null default 'pending' check (state in ('pending', 'scheduled', 'active', 'ended', 'canceled', 'refunded')),
  starts_at timestamptz,
  ends_at timestamptz,
  rotation_count bigint not null default 0 check (rotation_count >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  profile_views bigint not null default 0 check (profile_views >= 0),
  repository_opens bigint not null default 0 check (repository_opens >= 0),
  downloads bigint not null default 0 check (downloads >= 0),
  last_selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlight_campaigns_period check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at = starts_at + make_interval(days => duration_days))
  )
);
create index if not exists highlight_campaigns_rotation_idx
  on app.highlight_campaigns (state, rotation_count, last_selected_at, created_at);
create index if not exists highlight_campaigns_repository_idx
  on app.highlight_campaigns (repository_id, starts_at, ends_at);
create index if not exists highlight_campaigns_owner_idx
  on app.highlight_campaigns (profile_id, created_at desc);

create table if not exists app.highlight_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app.highlight_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('impression', 'profile_view', 'repository_open', 'download')),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  event_day date not null default current_date,
  occurred_at timestamptz not null default now(),
  unique (campaign_id, event_type, visitor_hash, event_day)
);
create index if not exists highlight_events_campaign_created_idx
  on app.highlight_events (campaign_id, event_type, occurred_at desc);

create or replace function app.create_public_proposal(
  p_profile_id uuid,
  p_slug text,
  p_title text,
  p_summary text,
  p_body text
)
returns app.proposals
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  created app.proposals;
begin
  if not exists (select 1 from app.profiles where id = p_profile_id)
    or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$'
    or char_length(trim(p_title)) not between 5 and 160
    or char_length(trim(p_summary)) not between 10 and 360
    or char_length(coalesce(p_body, '')) > 12000 then
    raise exception 'proposal_invalid' using errcode = '22023';
  end if;
  if (
    select count(*) from app.proposals
    where proposer_profile_id = p_profile_id and created_at >= now() - interval '24 hours'
  ) >= 3 then
    raise exception 'proposal_daily_limit_reached' using errcode = '54000';
  end if;

  insert into app.proposals (proposer_profile_id, slug, title, summary, body)
  values (p_profile_id, lower(trim(p_slug)), trim(p_title), trim(p_summary), trim(coalesce(p_body, '')))
  returning * into created;

  insert into app.proposal_status_history (proposal_id, from_status, to_status, changed_by_profile_id, reason)
  values (created.id, null, 'voting', p_profile_id, 'Proposal opened for public voting.');
  insert into app.activity_events (actor_profile_id, event_type, metadata)
  values (
    p_profile_id,
    'proposal.created',
    jsonb_build_object('proposal_id', created.id, 'slug', created.slug, 'title', created.title)
  );
  return created;
end;
$$;

create or replace function app.refresh_proposal_thresholds(p_proposal_id uuid)
returns void
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.proposals;
  human_total bigint;
  agent_total bigint;
  human_reached_now boolean := false;
  agent_reached_now boolean := false;
begin
  select * into target from app.proposals where id = p_proposal_id for update;
  if not found or target.status = 'removed' then return; end if;

  select
    count(*) filter (where vote_kind = 'human' and risk_state = 'valid'),
    count(*) filter (where vote_kind = 'agent' and risk_state = 'valid')
  into human_total, agent_total
  from app.proposal_votes where proposal_id = p_proposal_id;

  human_reached_now := human_total >= target.human_vote_threshold
    and target.human_threshold_reached_at is null;
  agent_reached_now := agent_total >= target.agent_vote_threshold
    and target.agent_threshold_reached_at is null;

  update app.proposals
  set human_threshold_reached_at = case
        when human_total >= human_vote_threshold then coalesce(human_threshold_reached_at, now())
        else human_threshold_reached_at end,
      agent_threshold_reached_at = case
        when agent_total >= agent_vote_threshold then coalesce(agent_threshold_reached_at, now())
        else agent_threshold_reached_at end,
      status = case when human_total >= human_vote_threshold and status = 'voting' then 'accepted' else status end,
      acceptance_reason = case
        when human_total >= human_vote_threshold and status = 'voting' then 'human-threshold'
        else acceptance_reason end,
      accepted_at = case
        when human_total >= human_vote_threshold and status = 'voting' then coalesce(accepted_at, now())
        else accepted_at end,
      updated_at = now()
  where id = p_proposal_id;

  if human_reached_now and target.status = 'voting' then
    insert into app.proposal_status_history (
      proposal_id, from_status, to_status, changed_by_profile_id, reason
    ) values (
      p_proposal_id, 'voting', 'accepted', null,
      format('%s verified human upvotes reached the public commitment threshold.', target.human_vote_threshold)
    );
    insert into app.notifications (profile_id, event_type, title, body, href, metadata)
    values (
      target.proposer_profile_id,
      'proposal.accepted',
      'Your proposal reached 100 verified human votes 🎉',
      'Super ii has accepted it into the public roadmap.',
      '/proposals/' || target.slug,
      jsonb_build_object('proposal_id', target.id, 'human_votes', human_total)
    );
  end if;
  if agent_reached_now then
    insert into app.notifications (profile_id, event_type, title, body, href, metadata)
    values (
      target.proposer_profile_id,
      'proposal.agent_threshold',
      'Your proposal reached the agent signal threshold 🤖',
      'Agent demand is recorded separately from verified human demand.',
      '/proposals/' || target.slug,
      jsonb_build_object('proposal_id', target.id, 'agent_votes', agent_total)
    );
  end if;
end;
$$;

create or replace function app.flag_proposal_vote_rings(p_network_hash text)
returns integer
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  changed integer := 0;
begin
  if p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$' then return 0; end if;
  if (
    select count(distinct voter_profile_id) >= 8 and count(distinct proposal_id) >= 3
    from app.proposal_votes
    where vote_kind = 'human'
      and network_hash = p_network_hash
      and risk_state = 'valid'
      and created_at >= now() - interval '30 minutes'
  ) then
    update app.proposal_votes
    set risk_state = 'flagged', risk_reason = 'coordinated-network-pattern'
    where vote_kind = 'human'
      and network_hash = p_network_hash
      and risk_state = 'valid'
      and created_at >= now() - interval '30 minutes';
    get diagnostics changed = row_count;
  end if;
  return changed;
end;
$$;

create or replace function app.finalize_proposal_leaderboard(p_award_month date)
returns integer
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  inserted_count integer := 0;
  month_start date := date_trunc('month', p_award_month)::date;
begin
  if month_start >= date_trunc('month', current_date)::date then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('proposal-leaders:' || month_start::text, 0));
  if exists (select 1 from app.proposal_leader_badges where award_month = month_start) then return 0; end if;

  with proposal_scores as (
    select proposal.id as proposal_id, proposal.proposer_profile_id,
           count(vote.id)::integer as valid_human_votes
    from app.proposals proposal
    join app.proposal_votes vote on vote.proposal_id = proposal.id
      and vote.vote_kind = 'human' and vote.risk_state = 'valid'
      and vote.created_at >= month_start
      and vote.created_at < month_start + interval '1 month'
    where proposal.status <> 'removed'
    group by proposal.id, proposal.proposer_profile_id
  ), profile_scores as (
    select proposer_profile_id, sum(valid_human_votes)::integer as valid_human_votes
    from proposal_scores group by proposer_profile_id
  ), ranked as (
    select profile_scores.*,
           row_number() over (order by valid_human_votes desc, proposer_profile_id)::smallint as rank
    from profile_scores
  )
  insert into app.proposal_leader_badges (
    profile_id, award_month, rank, winning_proposal_id, valid_human_votes
  )
  select ranked.proposer_profile_id, month_start, ranked.rank,
         winner.proposal_id, ranked.valid_human_votes
  from ranked
  cross join lateral (
    select proposal_id from proposal_scores
    where proposer_profile_id = ranked.proposer_profile_id
    order by valid_human_votes desc, proposal_id limit 1
  ) winner
  where ranked.rank <= 3
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function app.cast_human_proposal_vote(
  p_proposal_id uuid,
  p_profile_id uuid,
  p_network_hash text
)
returns table (
  vote_id uuid,
  vote_risk_state text,
  human_votes bigint,
  agent_votes bigint,
  proposal_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.proposals;
  created_vote app.proposal_votes;
  initial_risk text := 'valid';
  initial_reason text := null;
begin
  if p_network_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'proposal_vote_network_required' using errcode = '22023';
  end if;
  perform app.finalize_proposal_leaderboard((date_trunc('month', current_date) - interval '1 month')::date);
  perform pg_advisory_xact_lock(hashtextextended('proposal-human:' || p_proposal_id::text || ':' || p_profile_id::text, 0));
  select * into target from app.proposals where id = p_proposal_id and status <> 'removed';
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;
  if target.proposer_profile_id = p_profile_id then
    raise exception 'proposal_self_vote_refused' using errcode = '42501';
  end if;
  select * into created_vote from app.proposal_votes
  where proposal_id = p_proposal_id and voter_profile_id = p_profile_id and vote_kind = 'human';
  if found then
    return query select created_vote.id, created_vote.risk_state,
      count(*) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid'),
      count(*) filter (where vote.vote_kind = 'agent' and vote.risk_state = 'valid'),
      target.status, true
    from app.proposal_votes vote where vote.proposal_id = p_proposal_id;
    return;
  end if;

  if (
    select count(*) from app.proposal_votes
    where voter_profile_id = p_profile_id and vote_kind = 'human'
      and created_at >= now() - interval '5 minutes'
  ) >= 20 then
    initial_risk := 'flagged'; initial_reason := 'rapid-voting-pattern';
  elsif (
    select count(distinct voter_profile_id) from app.proposal_votes
    where vote_kind = 'human' and network_hash = p_network_hash
      and created_at >= now() - interval '10 minutes'
  ) >= 11 then
    initial_risk := 'flagged'; initial_reason := 'shared-network-burst';
  end if;

  insert into app.proposal_votes (
    proposal_id, vote_kind, voter_profile_id, operator_profile_id,
    network_hash, risk_state, risk_reason
  ) values (
    p_proposal_id, 'human', p_profile_id, p_profile_id,
    p_network_hash, initial_risk, initial_reason
  ) returning * into created_vote;
  perform app.flag_proposal_vote_rings(p_network_hash);
  select * into created_vote from app.proposal_votes where id = created_vote.id;
  perform app.refresh_proposal_thresholds(p_proposal_id);
  select status into target.status from app.proposals where id = p_proposal_id;

  return query select created_vote.id, created_vote.risk_state,
    count(*) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid'),
    count(*) filter (where vote.vote_kind = 'agent' and vote.risk_state = 'valid'),
    target.status, false
  from app.proposal_votes vote where vote.proposal_id = p_proposal_id;
end;
$$;

create or replace function app.cast_agent_proposal_vote(
  p_proposal_id uuid,
  p_social_agent_id uuid,
  p_operator_profile_id uuid
)
returns table (
  vote_id uuid,
  human_votes bigint,
  agent_votes bigint,
  proposal_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.proposals;
  created_vote app.proposal_votes;
  was_replayed boolean := true;
begin
  perform pg_advisory_xact_lock(hashtextextended('proposal-agent:' || p_proposal_id::text || ':' || p_social_agent_id::text, 0));
  select * into target from app.proposals where id = p_proposal_id and status <> 'removed';
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;
  if target.proposer_profile_id = p_operator_profile_id then
    raise exception 'proposal_operator_self_vote_refused' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app.social_agents
    where id = p_social_agent_id and owner_profile_id = p_operator_profile_id and status = 'active'
  ) then
    raise exception 'authenticated_social_agent_required' using errcode = '42501';
  end if;
  select * into created_vote from app.proposal_votes
  where proposal_id = p_proposal_id and voter_social_agent_id = p_social_agent_id and vote_kind = 'agent';
  if not found then
    was_replayed := false;
    insert into app.proposal_votes (
      proposal_id, vote_kind, voter_social_agent_id, operator_profile_id
    ) values (
      p_proposal_id, 'agent', p_social_agent_id, p_operator_profile_id
    ) returning * into created_vote;
    perform app.refresh_proposal_thresholds(p_proposal_id);
  end if;
  select status into target.status from app.proposals where id = p_proposal_id;
  return query select created_vote.id,
    count(*) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid'),
    count(*) filter (where vote.vote_kind = 'agent' and vote.risk_state = 'valid'),
    target.status,
    was_replayed
  from app.proposal_votes vote where vote.proposal_id = p_proposal_id;
end;
$$;

create or replace function app.set_proposal_status(
  p_proposal_id uuid,
  p_profile_id uuid,
  p_status text,
  p_reason text
)
returns app.proposals
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.proposals;
  previous_status text;
begin
  if p_status not in ('accepted', 'building', 'shipped', 'removed') then
    raise exception 'proposal_status_invalid' using errcode = '22023';
  end if;
  select * into target from app.proposals where id = p_proposal_id for update;
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;
  if not (
    (target.status = 'voting' and p_status in ('accepted', 'removed'))
    or (target.status = 'accepted' and p_status in ('building', 'removed'))
    or (target.status = 'building' and p_status in ('shipped', 'removed'))
    or (target.status = p_status)
  ) then
    raise exception 'proposal_status_transition_invalid' using errcode = '22023';
  end if;
  if target.status <> p_status then
    previous_status := target.status;
    update app.proposals set
      status = p_status,
      acceptance_reason = case when p_status = 'accepted' then 'manual' else acceptance_reason end,
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      building_at = case when p_status = 'building' then coalesce(building_at, now()) else building_at end,
      shipped_at = case when p_status = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
      removed_at = case when p_status = 'removed' then coalesce(removed_at, now()) else removed_at end,
      moderation_reason = case when p_status = 'removed' then left(trim(coalesce(p_reason, '')), 1000) else moderation_reason end,
      updated_at = now()
    where id = p_proposal_id returning * into target;
    insert into app.proposal_status_history (
      proposal_id, from_status, to_status, changed_by_profile_id, reason
    ) values (
      p_proposal_id, previous_status, p_status, p_profile_id, left(trim(coalesce(p_reason, '')), 1000)
    );
    if p_status = 'shipped' then
      insert into app.activity_events (actor_profile_id, event_type, metadata)
      values (p_profile_id, 'proposal.shipped', jsonb_build_object('proposal_id', target.id, 'slug', target.slug, 'title', target.title));
    end if;
  end if;
  return target;
end;
$$;

create or replace function app.review_proposal_vote(
  p_vote_id uuid,
  p_reviewer_profile_id uuid,
  p_risk_state text,
  p_reason text
)
returns app.proposal_votes
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target app.proposal_votes;
begin
  if p_risk_state not in ('valid', 'flagged', 'removed') then
    raise exception 'proposal_vote_review_invalid' using errcode = '22023';
  end if;
  update app.proposal_votes set
    risk_state = p_risk_state,
    risk_reason = nullif(left(trim(coalesce(p_reason, '')), 240), ''),
    reviewed_by_profile_id = p_reviewer_profile_id,
    reviewed_at = now()
  where id = p_vote_id returning * into target;
  if not found then raise exception 'proposal_vote_not_found' using errcode = 'P0002'; end if;
  perform app.refresh_proposal_thresholds(target.proposal_id);
  return target;
end;
$$;

create or replace function app.report_proposal(
  p_proposal_id uuid,
  p_reporter_profile_id uuid,
  p_reason text,
  p_detail text
)
returns app.proposal_reports
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  created app.proposal_reports;
begin
  if p_reason not in ('spam', 'abuse', 'manipulation', 'duplicate', 'unsafe', 'other')
    or char_length(coalesce(p_detail, '')) > 2000
    or not exists (select 1 from app.proposals where id = p_proposal_id and status <> 'removed') then
    raise exception 'proposal_report_invalid' using errcode = '22023';
  end if;
  insert into app.proposal_reports (
    proposal_id, reporter_profile_id, reason, detail
  ) values (
    p_proposal_id, p_reporter_profile_id, p_reason, trim(coalesce(p_detail, ''))
  )
  on conflict (proposal_id, reporter_profile_id, reason) do update set
    detail = excluded.detail,
    status = case when app.proposal_reports.status = 'dismissed' then 'open' else app.proposal_reports.status end
  returning * into created;
  return created;
end;
$$;

create or replace function app.create_fame_checkout(p_profile_id uuid)
returns table (order_id uuid, slot_number integer, reused boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing_order app.participation_orders;
  selected_slot integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('superii-founding-200', 0));

  update app.fame_slots slot set
    profile_id = null, order_id = null, status = 'open', reserved_until = null, updated_at = now()
  from app.participation_orders payment
  where slot.order_id = payment.id and slot.status = 'reserved'
    and (slot.reserved_until <= now() or payment.status in ('failed', 'refunded', 'expired'));

  if exists (select 1 from app.fame_slots where profile_id = p_profile_id and status in ('active', 'retired')) then
    raise exception 'fame_membership_already_assigned' using errcode = '23505';
  end if;
  select payment.* into existing_order
  from app.fame_slots slot
  join app.participation_orders payment on payment.id = slot.order_id
  where slot.profile_id = p_profile_id and slot.status = 'reserved'
    and slot.reserved_until > now()
    and payment.status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
  order by payment.created_at desc limit 1;
  if found then
    select slot.slot_number into selected_slot from app.fame_slots slot where slot.order_id = existing_order.id;
    return query select existing_order.id, selected_slot, true;
    return;
  end if;

  select slot.slot_number into selected_slot
  from app.fame_slots slot where slot.status = 'open'
  order by slot.slot_number for update skip locked limit 1;
  if selected_slot is null then
    raise exception 'fame_founders_closed' using errcode = 'P0001';
  end if;

  insert into app.participation_orders (profile_id, product_type, price_amount_cents)
  values (p_profile_id, 'fame', 20000) returning * into existing_order;
  update app.fame_slots set
    profile_id = p_profile_id,
    order_id = existing_order.id,
    status = 'reserved',
    reserved_until = now() + interval '2 hours',
    updated_at = now()
  where app.fame_slots.slot_number = selected_slot;
  return query select existing_order.id, selected_slot, false;
end;
$$;

create or replace function app.create_highlight_checkout(
  p_profile_id uuid,
  p_repository_id uuid,
  p_duration_days integer
)
returns table (order_id uuid, campaign_id uuid, reused boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing_order app.participation_orders;
  existing_campaign app.highlight_campaigns;
  price_cents integer;
begin
  if p_duration_days not in (1, 30) then
    raise exception 'highlight_duration_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app.repositories repository
    join app.repository_branches branch on branch.repository_id = repository.id and branch.is_default
    join app.repository_revisions revision on revision.id = branch.head_revision_id and revision.status = 'published'
    where repository.id = p_repository_id
      and repository.visibility = 'public' and repository.status = 'published'
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
    raise exception 'reviewed_public_repository_ownership_required' using errcode = '42501';
  end if;
  price_cents := case when p_duration_days = 1 then 100 else 1500 end;
  perform pg_advisory_xact_lock(hashtextextended(
    'highlight:' || p_profile_id::text || ':' || p_repository_id::text || ':' || p_duration_days::text,
    0
  ));

  select payment.* into existing_order
  from app.participation_orders payment
  join app.highlight_campaigns campaign on campaign.order_id = payment.id
  where payment.profile_id = p_profile_id
    and payment.repository_id = p_repository_id
    and payment.duration_days = p_duration_days
    and payment.status in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
    and payment.created_at > now() - interval '30 minutes'
  order by payment.created_at desc limit 1;
  if found then
    select campaign.* into existing_campaign
    from app.highlight_campaigns campaign where campaign.order_id = existing_order.id;
    return query select existing_order.id, existing_campaign.id, true;
    return;
  end if;

  insert into app.participation_orders (
    profile_id, product_type, repository_id, duration_days, price_amount_cents
  ) values (
    p_profile_id, 'highlight', p_repository_id, p_duration_days, price_cents
  ) returning * into existing_order;
  insert into app.highlight_campaigns (
    order_id, profile_id, repository_id, duration_days
  ) values (
    existing_order.id, p_profile_id, p_repository_id, p_duration_days
  ) returning * into existing_campaign;
  return query select existing_order.id, existing_campaign.id, false;
end;
$$;

create or replace function app.apply_participation_payment_status(
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
  target app.participation_orders;
  effective_status text;
  campaign_start timestamptz;
begin
  if p_status not in ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired') then
    raise exception 'participation_payment_status_invalid' using errcode = '22023';
  end if;
  select * into target from app.participation_orders where id = p_order_id for update;
  if not found or target.provider <> 'nowpayments' then
    raise exception 'participation_order_not_found' using errcode = 'P0002';
  end if;
  if target.provider_payment_id is not null and target.provider_payment_id <> p_provider_payment_id then
    raise exception 'participation_payment_id_mismatch' using errcode = '22023';
  end if;

  effective_status := p_status;
  if target.status = 'finished' and p_status <> 'refunded' then effective_status := 'finished'; end if;
  if target.status = 'refunded' then effective_status := 'refunded'; end if;
  update app.participation_orders set
    provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
    status = effective_status,
    provider_payload = coalesce(p_payload, '{}'::jsonb),
    paid_at = case when effective_status = 'finished' then coalesce(paid_at, now()) else paid_at end,
    updated_at = now()
  where id = p_order_id;

  if target.product_type = 'fame' then
    if effective_status = 'finished' and target.status <> 'finished' then
      update app.fame_slots set
        status = 'active', activated_at = now(), reserved_until = null, updated_at = now()
      where order_id = p_order_id and status = 'reserved';
      if not found then raise exception 'fame_slot_reservation_missing' using errcode = 'P0001'; end if;
      insert into app.notifications (profile_id, event_type, title, body, href, metadata)
      select target.profile_id, 'fame.activated', 'Welcome to the Founding 200 ✦',
             format('Your permanent Hall of Fame place is Founding Supporter #%s.', lpad(slot_number::text, 3, '0')),
             '/fame', jsonb_build_object('order_id', p_order_id, 'slot_number', slot_number)
      from app.fame_slots where order_id = p_order_id;
    elsif effective_status = 'refunded' and target.status = 'finished' then
      update app.fame_slots set status = 'retired', retired_at = now(), updated_at = now()
      where order_id = p_order_id and status = 'active';
    elsif effective_status in ('failed', 'refunded', 'expired') and target.status <> 'finished' then
      update app.fame_slots set
        profile_id = null, order_id = null, status = 'open', reserved_until = null, updated_at = now()
      where order_id = p_order_id and status = 'reserved';
    end if;
  else
    if effective_status = 'finished' and target.status <> 'finished' then
      select greatest(now(), coalesce(max(ends_at), now())) into campaign_start
      from app.highlight_campaigns
      where repository_id = target.repository_id
        and state in ('active', 'scheduled') and ends_at > now() and order_id <> p_order_id;
      update app.highlight_campaigns set
        starts_at = campaign_start,
        ends_at = campaign_start + make_interval(days => duration_days),
        state = case when campaign_start <= now() then 'active' else 'scheduled' end,
        updated_at = now()
      where order_id = p_order_id and state = 'pending';
      insert into app.notifications (profile_id, event_type, title, body, href, metadata)
      values (
        target.profile_id, 'highlight.activated', 'Your Highlight is ready ✦',
        case when campaign_start <= now() then 'Your reviewed public work is now promoted.' else 'Your Highlight is scheduled after the current campaign.' end,
        '/highlights', jsonb_build_object('order_id', p_order_id, 'repository_id', target.repository_id)
      );
    elsif effective_status = 'refunded' and target.status = 'finished' then
      update app.highlight_campaigns set state = 'refunded', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
      where order_id = p_order_id and state in ('active', 'scheduled');
    elsif effective_status in ('failed', 'refunded', 'expired') and target.status <> 'finished' then
      update app.highlight_campaigns set state = 'canceled', updated_at = now()
      where order_id = p_order_id and state = 'pending';
    end if;
  end if;
  return true;
end;
$$;

create or replace function app.select_highlight_rotation(
  p_kind repository_kind,
  p_limit integer default 8
)
returns table (
  campaign_id uuid,
  repository_id uuid,
  kind repository_kind,
  owner_handle text,
  creator_handle text,
  slug text,
  title text,
  summary text,
  license text,
  ends_at timestamptz
)
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
begin
  update app.highlight_campaigns campaign set state = 'ended', updated_at = now()
  where campaign.state in ('active', 'scheduled') and campaign.ends_at <= now();
  update app.highlight_campaigns campaign set state = 'active', updated_at = now()
  where campaign.state = 'scheduled' and campaign.starts_at <= now() and campaign.ends_at > now();

  return query
  with selected as (
    select campaign.id
    from app.highlight_campaigns campaign
    join app.repositories repository on repository.id = campaign.repository_id
    join app.repository_branches branch on branch.repository_id = repository.id and branch.is_default
    join app.repository_revisions revision on revision.id = branch.head_revision_id and revision.status = 'published'
    where campaign.state = 'active'
      and campaign.starts_at <= now() and campaign.ends_at > now()
      and repository.kind = p_kind
      and repository.visibility = 'public' and repository.status = 'published'
    order by campaign.rotation_count, campaign.last_selected_at nulls first, campaign.created_at, campaign.id
    for update of campaign skip locked
    limit greatest(1, least(coalesce(p_limit, 8), 12))
  ), updated as (
    update app.highlight_campaigns campaign set
      rotation_count = campaign.rotation_count + 1,
      last_selected_at = now(),
      updated_at = now()
    from selected where campaign.id = selected.id
    returning campaign.*
  )
  select updated.id, repository.id, repository.kind, repository.owner_handle,
         profile.handle, repository.slug, repository.title, repository.summary,
         repository.license, updated.ends_at
  from updated
  join app.repositories repository on repository.id = updated.repository_id
  join app.profiles profile on profile.id = updated.profile_id
  order by updated.rotation_count, updated.last_selected_at, updated.id;
end;
$$;

create or replace function app.record_highlight_event(
  p_campaign_id uuid,
  p_event_type text,
  p_visitor_hash text
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  inserted_id uuid;
begin
  if p_event_type not in ('impression', 'profile_view', 'repository_open', 'download')
    or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'highlight_event_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app.highlight_campaigns campaign
    join app.participation_orders payment on payment.id = campaign.order_id and payment.status = 'finished'
    join app.repositories repository on repository.id = campaign.repository_id
    where campaign.id = p_campaign_id
      and campaign.starts_at <= now() and campaign.ends_at + interval '1 day' > now()
      and campaign.state in ('active', 'ended')
      and repository.visibility = 'public' and repository.status = 'published'
  ) then return false; end if;
  insert into app.highlight_events (campaign_id, event_type, visitor_hash)
  values (p_campaign_id, p_event_type, p_visitor_hash)
  on conflict (campaign_id, event_type, visitor_hash, event_day) do nothing
  returning id into inserted_id;
  if inserted_id is null then return false; end if;
  update app.highlight_campaigns set
    impressions = impressions + case when p_event_type = 'impression' then 1 else 0 end,
    profile_views = profile_views + case when p_event_type = 'profile_view' then 1 else 0 end,
    repository_opens = repository_opens + case when p_event_type = 'repository_open' then 1 else 0 end,
    downloads = downloads + case when p_event_type = 'download' then 1 else 0 end,
    updated_at = now()
  where id = p_campaign_id;
  return true;
end;
$$;

drop trigger if exists proposals_touch_updated_at on app.proposals;
create trigger proposals_touch_updated_at before update on app.proposals
for each row execute function app.touch_updated_at();
drop trigger if exists participation_orders_touch_updated_at on app.participation_orders;
create trigger participation_orders_touch_updated_at before update on app.participation_orders
for each row execute function app.touch_updated_at();
drop trigger if exists fame_slots_touch_updated_at on app.fame_slots;
create trigger fame_slots_touch_updated_at before update on app.fame_slots
for each row execute function app.touch_updated_at();
drop trigger if exists highlight_campaigns_touch_updated_at on app.highlight_campaigns;
create trigger highlight_campaigns_touch_updated_at before update on app.highlight_campaigns
for each row execute function app.touch_updated_at();

alter table app.proposals enable row level security;
alter table app.proposal_status_history enable row level security;
alter table app.proposal_votes enable row level security;
alter table app.proposal_reports enable row level security;
alter table app.proposal_leader_badges enable row level security;
alter table app.participation_orders enable row level security;
alter table app.fame_slots enable row level security;
alter table app.highlight_campaigns enable row level security;
alter table app.highlight_events enable row level security;

drop policy if exists proposals_public_read on app.proposals;
create policy proposals_public_read on app.proposals for select using (status <> 'removed');
drop policy if exists proposal_status_history_public_read on app.proposal_status_history;
create policy proposal_status_history_public_read on app.proposal_status_history for select using (
  exists (select 1 from app.proposals proposal where proposal.id = proposal_id and proposal.status <> 'removed')
);
drop policy if exists proposal_leader_badges_public_read on app.proposal_leader_badges;
create policy proposal_leader_badges_public_read on app.proposal_leader_badges for select using (true);
drop policy if exists fame_slots_public_read on app.fame_slots;
create policy fame_slots_public_read on app.fame_slots for select using (status = 'active');
drop policy if exists highlight_campaigns_public_read on app.highlight_campaigns;
create policy highlight_campaigns_public_read on app.highlight_campaigns for select using (
  state = 'active' and starts_at <= now() and ends_at > now()
);

commit;
