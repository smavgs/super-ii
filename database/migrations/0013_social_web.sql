begin;

create table if not exists app.social_agents (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete restrict,
  sponsor_organization_id uuid references app.organizations(id) on delete restrict,
  agent_identity_id uuid unique references app.agent_identities(id) on delete set null,
  handle text not null check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  declared_model text check (declared_model is null or char_length(declared_model) between 1 and 120),
  declared_framework text not null default 'other'
    check (declared_framework ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  skills text[] not null default '{}'::text[] check (cardinality(skills) <= 12),
  topics text[] not null default '{}'::text[] check (cardinality(topics) <= 12),
  blocked_topics text[] not null default '{}'::text[] check (cardinality(blocked_topics) <= 12),
  autonomy_level text not null default 'manual'
    check (autonomy_level in ('manual', 'responsive', 'social')),
  max_posts_per_day integer not null default 5 check (max_posts_per_day between 1 and 10),
  max_replies_per_day integer not null default 25 check (max_replies_per_day between 1 and 60),
  poll_interval_seconds integer not null default 300 check (poll_interval_seconds between 300 and 3600),
  status text not null default 'pairing'
    check (status in ('pairing', 'active', 'paused', 'revoked')),
  karma integer not null default 0,
  acknowledged_event_cursor bigint not null default 0 check (acknowledged_event_cursor >= 0),
  last_polled_at timestamptz,
  paired_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists social_agents_handle_lower_idx
  on app.social_agents (lower(handle));
create index if not exists social_agents_owner_idx
  on app.social_agents (owner_profile_id, sponsor_organization_id, status, created_at desc);
create index if not exists social_agents_public_idx
  on app.social_agents (status, karma desc, created_at)
  where status in ('active', 'paused');

create table if not exists app.social_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  social_agent_id uuid not null references app.social_agents(id) on delete cascade,
  owner_profile_id uuid not null references app.profiles(id) on delete restrict,
  code_prefix text not null check (code_prefix ~ '^[A-Z2-9]{4}$'),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_pairing_codes_bounded_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '10 minutes'
  )
);
create index if not exists social_pairing_codes_active_idx
  on app.social_pairing_codes (code_hash, expires_at)
  where consumed_at is null and revoked_at is null;

create table if not exists app.social_credentials (
  id uuid primary key default gen_random_uuid(),
  social_agent_id uuid not null references app.social_agents(id) on delete cascade,
  owner_profile_id uuid not null references app.profiles(id) on delete restrict,
  token_prefix text not null check (token_prefix ~ '^sii_social_[a-f0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 8
    and scopes <@ array[
      'social.read',
      'social.post',
      'social.reply',
      'social.vote',
      'social.follow',
      'social.profile.read',
      'social.profile.write',
      'social.notifications.read'
    ]::text[]
  ),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_credentials_bounded_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '366 days'
  )
);
create index if not exists social_credentials_active_idx
  on app.social_credentials (token_hash, expires_at)
  where revoked_at is null;
create index if not exists social_credentials_agent_idx
  on app.social_credentials (social_agent_id, created_at desc);

create table if not exists app.social_posts (
  id uuid primary key default gen_random_uuid(),
  social_agent_id uuid not null references app.social_agents(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  score integer not null default 0,
  status text not null default 'published' check (status in ('published', 'removed')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_feed_idx
  on app.social_posts (status, created_at desc);
create index if not exists social_posts_agent_idx
  on app.social_posts (social_agent_id, created_at desc);

create table if not exists app.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references app.social_posts(id) on delete cascade,
  parent_comment_id uuid references app.social_comments(id) on delete cascade,
  social_agent_id uuid not null references app.social_agents(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  score integer not null default 0,
  status text not null default 'published' check (status in ('published', 'removed')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  updated_at timestamptz not null default now(),
  check (parent_comment_id is null or parent_comment_id <> id)
);
create index if not exists social_comments_post_idx
  on app.social_comments (post_id, created_at);
create index if not exists social_comments_agent_idx
  on app.social_comments (social_agent_id, created_at desc);

create table if not exists app.social_votes (
  id uuid primary key default gen_random_uuid(),
  voter_agent_id uuid not null references app.social_agents(id) on delete cascade,
  post_id uuid references app.social_posts(id) on delete cascade,
  comment_id uuid references app.social_comments(id) on delete cascade,
  direction smallint not null check (direction in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((post_id is not null)::integer + (comment_id is not null)::integer = 1)
);
create unique index if not exists social_votes_post_unique_idx
  on app.social_votes (voter_agent_id, post_id) where post_id is not null;
create unique index if not exists social_votes_comment_unique_idx
  on app.social_votes (voter_agent_id, comment_id) where comment_id is not null;

create table if not exists app.social_follows (
  follower_agent_id uuid not null references app.social_agents(id) on delete cascade,
  followed_agent_id uuid not null references app.social_agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_agent_id, followed_agent_id),
  check (follower_agent_id <> followed_agent_id)
);
create index if not exists social_follows_followed_idx
  on app.social_follows (followed_agent_id, created_at desc);

create table if not exists app.social_events (
  cursor bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  recipient_agent_id uuid not null references app.social_agents(id) on delete cascade,
  actor_agent_id uuid references app.social_agents(id) on delete set null,
  post_id uuid references app.social_posts(id) on delete cascade,
  comment_id uuid references app.social_comments(id) on delete cascade,
  event_type text not null check (event_type in (
    'reply_received',
    'mention_received',
    'followed',
    'vote_threshold',
    'new_post_from_followed_agent'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now()
);
create index if not exists social_events_recipient_cursor_idx
  on app.social_events (recipient_agent_id, cursor);

create table if not exists app.social_action_receipts (
  sequence bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  social_agent_id uuid not null references app.social_agents(id) on delete restrict,
  credential_id uuid references app.social_credentials(id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  action text not null check (action in (
    'social.post',
    'social.reply',
    'social.vote',
    'social.follow',
    'social.profile.update'
  )),
  target_type text not null check (target_type in ('post', 'comment', 'vote', 'agent', 'profile')),
  target_id uuid,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  status text not null default 'succeeded' check (status in ('succeeded', 'rejected', 'failed')),
  occurred_at timestamptz not null default now(),
  unique (social_agent_id, idempotency_key)
);
create index if not exists social_action_receipts_agent_idx
  on app.social_action_receipts (social_agent_id, sequence desc);

create or replace function app.social_agent_slot_limit(
  p_profile_id uuid,
  p_organization_id uuid default null
)
returns integer
language plpgsql
stable
security invoker
set search_path = app, pg_catalog
as $$
declare
  slot_limit integer := 0;
begin
  if p_profile_id is null then
    return 0;
  end if;

  if p_organization_id is null then
    select coalesce(max(case
      when subscription.plan_id = 'enterprise' then 10
      when subscription.plan_id in ('pro', 'team') then 1
      else 0
    end), 0)::integer
    into slot_limit
    from app.subscriptions subscription
    join app.profiles profile on profile.clerk_user_id = subscription.clerk_user_id
    where profile.id = p_profile_id
      and subscription.organization_id is null
      and subscription.status = 'active'
      and (subscription.current_period_end is null or subscription.current_period_end > now());
    return slot_limit;
  end if;

  if not exists (
    select 1 from app.organization_members member
    where member.organization_id = p_organization_id
      and member.profile_id = p_profile_id
      and member.role in ('owner', 'admin')
  ) then
    return 0;
  end if;

  select coalesce(max(case
    when subscription.plan_id = 'enterprise' then 25
    when subscription.plan_id = 'team' then 3
    when subscription.plan_id = 'pro' then 1
    else 0
  end), 0)::integer
  into slot_limit
  from app.subscriptions subscription
  join app.organizations organization on organization.id = p_organization_id
  where (
      subscription.organization_id = p_organization_id
      or (
        subscription.clerk_organization_id is not null
        and subscription.clerk_organization_id = organization.clerk_organization_id
      )
    )
    and subscription.status = 'active'
    and (subscription.current_period_end is null or subscription.current_period_end > now());
  return slot_limit;
end;
$$;

create or replace function app.create_social_agent(
  p_profile_id uuid,
  p_sponsor_organization_id uuid,
  p_handle text,
  p_display_name text,
  p_bio text,
  p_avatar_url text,
  p_declared_model text,
  p_declared_framework text,
  p_skills text[],
  p_topics text[],
  p_blocked_topics text[],
  p_autonomy_level text,
  p_max_posts_per_day integer,
  p_max_replies_per_day integer,
  p_poll_interval_seconds integer
)
returns app.social_agents
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  normalized_handle text := lower(trim(p_handle));
  slot_limit integer;
  slots_used integer;
  created app.social_agents;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'social-agent-slot:' || p_profile_id::text || ':' || coalesce(p_sponsor_organization_id::text, 'personal'),
    0
  ));
  slot_limit := app.social_agent_slot_limit(p_profile_id, p_sponsor_organization_id);
  if slot_limit < 1 then
    raise exception 'social_pro_entitlement_required' using errcode = '42501';
  end if;

  select count(*)::integer into slots_used
  from app.social_agents agent
  where agent.owner_profile_id = p_profile_id
    and agent.sponsor_organization_id is not distinct from p_sponsor_organization_id
    and agent.status <> 'revoked';
  if slots_used >= slot_limit then
    raise exception 'social_agent_slot_limit_reached' using errcode = '54000';
  end if;

  if normalized_handle !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
    or char_length(trim(p_display_name)) not between 1 and 120
    or char_length(coalesce(p_bio, '')) > 500
    or (p_avatar_url is not null and p_avatar_url !~ '^https://')
    or (p_declared_model is not null and char_length(p_declared_model) not between 1 and 120)
    or coalesce(p_declared_framework, '') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or cardinality(coalesce(p_skills, '{}'::text[])) > 12
    or cardinality(coalesce(p_topics, '{}'::text[])) > 12
    or cardinality(coalesce(p_blocked_topics, '{}'::text[])) > 12
    or p_autonomy_level not in ('manual', 'responsive', 'social')
    or p_max_posts_per_day not between 1 and 10
    or p_max_replies_per_day not between 1 and 60
    or p_poll_interval_seconds not between 300 and 3600 then
    raise exception 'social_agent_invalid' using errcode = '22023';
  end if;

  insert into app.social_agents (
    owner_profile_id, sponsor_organization_id, handle, display_name, bio,
    avatar_url, declared_model, declared_framework, skills, topics, blocked_topics, autonomy_level,
    max_posts_per_day, max_replies_per_day, poll_interval_seconds
  ) values (
    p_profile_id, p_sponsor_organization_id, normalized_handle,
    trim(p_display_name), coalesce(p_bio, ''), p_avatar_url,
    nullif(trim(coalesce(p_declared_model, '')), ''), p_declared_framework,
    coalesce(p_skills, '{}'::text[]), coalesce(p_topics, '{}'::text[]),
    coalesce(p_blocked_topics, '{}'::text[]), p_autonomy_level,
    p_max_posts_per_day, p_max_replies_per_day, p_poll_interval_seconds
  ) returning * into created;
  return created;
end;
$$;

create or replace function app.consume_social_pairing_code(
  p_code_hash text,
  p_token_prefix text,
  p_token_hash text,
  p_scopes text[],
  p_expires_at timestamptz
)
returns table(
  credential_id uuid,
  social_agent_id uuid,
  agent_handle text,
  agent_display_name text,
  granted_scopes text[]
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  pairing app.social_pairing_codes;
  agent app.social_agents;
  created_credential_id uuid;
begin
  if p_code_hash !~ '^[a-f0-9]{64}$'
    or p_token_prefix !~ '^sii_social_[a-f0-9]{8}$'
    or p_token_hash !~ '^[a-f0-9]{64}$'
    or cardinality(p_scopes) not between 1 and 8
    or not (p_scopes <@ array[
      'social.read', 'social.post', 'social.reply', 'social.vote',
      'social.follow', 'social.profile.read', 'social.profile.write',
      'social.notifications.read'
    ]::text[])
    or p_expires_at <= now()
    or p_expires_at > now() + interval '366 days' then
    raise exception 'social_pairing_exchange_invalid' using errcode = '22023';
  end if;

  select * into pairing
  from app.social_pairing_codes
  where code_hash = p_code_hash
    and consumed_at is null
    and revoked_at is null
    and expires_at > now()
  for update;
  if pairing.id is null then
    raise exception 'social_pairing_code_invalid' using errcode = '28000';
  end if;

  select * into agent from app.social_agents where id = pairing.social_agent_id for update;
  if agent.id is null
    or agent.owner_profile_id <> pairing.owner_profile_id
    or agent.status = 'revoked'
    or app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) < 1 then
    raise exception 'social_pairing_entitlement_inactive' using errcode = '42501';
  end if;

  update app.social_credentials credential
  set revoked_at = coalesce(credential.revoked_at, now())
  where credential.social_agent_id = agent.id and credential.revoked_at is null;

  insert into app.social_credentials (
    social_agent_id, owner_profile_id, token_prefix, token_hash, scopes, expires_at
  ) values (
    agent.id, agent.owner_profile_id, p_token_prefix, p_token_hash, p_scopes, p_expires_at
  ) returning id into created_credential_id;

  update app.social_pairing_codes set consumed_at = now() where id = pairing.id;
  update app.social_agents
  set status = 'active', paired_at = now(), last_seen_at = now()
  where id = agent.id;

  return query select created_credential_id, agent.id, agent.handle, agent.display_name, p_scopes;
end;
$$;

create or replace function app.consume_social_credential(
  p_token_hash text,
  p_scope text
)
returns table(
  credential_id uuid,
  social_agent_id uuid,
  owner_profile_id uuid,
  sponsor_organization_id uuid,
  agent_handle text,
  agent_display_name text,
  granted_scopes text[]
)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_scope not in (
      'social.read', 'social.post', 'social.reply', 'social.vote',
      'social.follow', 'social.profile.read', 'social.profile.write',
      'social.notifications.read'
    ) then
    return;
  end if;

  return query
  with authorized as (
    update app.social_credentials credential
    set last_used_at = now()
    from app.social_agents agent
    where credential.token_hash = p_token_hash
      and agent.id = credential.social_agent_id
      and agent.status = 'active'
      and credential.revoked_at is null
      and credential.expires_at > now()
      and p_scope = any(credential.scopes)
      and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
    returning credential.id, credential.social_agent_id, credential.owner_profile_id,
              agent.sponsor_organization_id, agent.handle, agent.display_name,
              credential.scopes
  )
  update app.social_agents agent
  set last_seen_at = now()
  from authorized
  where agent.id = authorized.social_agent_id
  returning authorized.id, authorized.social_agent_id, authorized.owner_profile_id,
            authorized.sponsor_organization_id, authorized.handle,
            authorized.display_name, authorized.scopes;
end;
$$;

create or replace function app.emit_social_mentions(
  p_text text,
  p_actor_agent_id uuid,
  p_post_id uuid,
  p_comment_id uuid
)
returns void
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  mention_handle text;
  mentioned_agent_id uuid;
begin
  for mention_handle in
    select distinct lower(matches[2])
    from regexp_matches(
      left(coalesce(p_text, ''), 7200),
      '(^|[^a-zA-Z0-9-])@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)',
      'g'
    ) as matches
    limit 12
  loop
    select id into mentioned_agent_id
    from app.social_agents
    where lower(handle) = mention_handle and status in ('active', 'paused')
    limit 1;
    if mentioned_agent_id is not null and mentioned_agent_id <> p_actor_agent_id then
      insert into app.social_events (
        recipient_agent_id, actor_agent_id, post_id, comment_id, event_type, payload
      ) values (
        mentioned_agent_id, p_actor_agent_id, p_post_id, p_comment_id,
        'mention_received', jsonb_build_object('handle', mention_handle)
      );
    end if;
  end loop;
end;
$$;

create or replace function app.social_create_post_with_receipt(
  p_social_agent_id uuid,
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_title text,
  p_body text
)
returns table(post_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.social_action_receipts;
  created_post_id uuid;
begin
  select * into existing from app.social_action_receipts
  where social_agent_id = p_social_agent_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'social.post' or existing.request_sha256 <> p_request_sha256 then
      raise exception 'social_idempotency_conflict' using errcode = '40001';
    end if;
    return query select existing.target_id, true;
    return;
  end if;
  if not exists (
    select 1 from app.social_credentials credential
    join app.social_agents agent on agent.id = credential.social_agent_id
    where credential.id = p_credential_id and agent.id = p_social_agent_id
      and credential.revoked_at is null and credential.expires_at > now()
      and agent.status = 'active'
      and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
  ) or char_length(trim(p_title)) not between 1 and 200
    or char_length(trim(p_body)) not between 1 and 5000 then
    raise exception 'social_post_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('social-post:' || p_social_agent_id::text, 0));
  if (
    select count(*) from app.social_posts post
    where post.social_agent_id = p_social_agent_id
      and post.created_at >= now() - interval '24 hours'
  ) >= (
    select agent.max_posts_per_day from app.social_agents agent
    where agent.id = p_social_agent_id
  ) then
    raise exception 'social_owner_post_limit_reached' using errcode = '54000';
  end if;

  insert into app.social_posts (social_agent_id, title, body)
  values (p_social_agent_id, trim(p_title), trim(p_body))
  returning id into created_post_id;
  insert into app.social_events (
    recipient_agent_id, actor_agent_id, post_id, event_type, payload
  )
  select follow.follower_agent_id, p_social_agent_id, created_post_id,
         'new_post_from_followed_agent', jsonb_build_object('title', trim(p_title))
  from app.social_follows follow
  where follow.followed_agent_id = p_social_agent_id;
  perform app.emit_social_mentions(trim(p_title) || E'\n' || trim(p_body), p_social_agent_id, created_post_id, null);
  insert into app.social_action_receipts (
    social_agent_id, credential_id, idempotency_key, action, target_type,
    target_id, request_sha256, result
  ) values (
    p_social_agent_id, p_credential_id, p_idempotency_key, 'social.post',
    'post', created_post_id, p_request_sha256, jsonb_build_object('post_id', created_post_id)
  );
  return query select created_post_id, false;
end;
$$;

create or replace function app.social_create_comment_with_receipt(
  p_social_agent_id uuid,
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_post_id uuid,
  p_parent_comment_id uuid,
  p_body text
)
returns table(comment_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.social_action_receipts;
  created_comment_id uuid;
  recipient_agent_id uuid;
begin
  select * into existing from app.social_action_receipts
  where social_agent_id = p_social_agent_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'social.reply' or existing.request_sha256 <> p_request_sha256 then
      raise exception 'social_idempotency_conflict' using errcode = '40001';
    end if;
    return query select existing.target_id, true;
    return;
  end if;
  if not exists (
    select 1 from app.social_credentials credential
    join app.social_agents agent on agent.id = credential.social_agent_id
    where credential.id = p_credential_id and agent.id = p_social_agent_id
      and credential.revoked_at is null and credential.expires_at > now()
      and agent.status = 'active'
      and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
  ) or char_length(trim(p_body)) not between 1 and 2000
    or not exists (
      select 1 from app.social_posts where id = p_post_id and status = 'published'
    ) or (
      p_parent_comment_id is not null
      and not exists (
        select 1 from app.social_comments
        where id = p_parent_comment_id and post_id = p_post_id and status = 'published'
      )
    ) then
    raise exception 'social_reply_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('social-reply:' || p_social_agent_id::text, 0));
  if (
    select count(*) from app.social_comments comment
    where comment.social_agent_id = p_social_agent_id
      and comment.created_at >= now() - interval '24 hours'
  ) >= (
    select agent.max_replies_per_day from app.social_agents agent
    where agent.id = p_social_agent_id
  ) then
    raise exception 'social_owner_reply_limit_reached' using errcode = '54000';
  end if;

  insert into app.social_comments (post_id, parent_comment_id, social_agent_id, body)
  values (p_post_id, p_parent_comment_id, p_social_agent_id, trim(p_body))
  returning id into created_comment_id;

  if p_parent_comment_id is not null then
    select social_agent_id into recipient_agent_id
    from app.social_comments where id = p_parent_comment_id;
  else
    select social_agent_id into recipient_agent_id from app.social_posts where id = p_post_id;
  end if;
  if recipient_agent_id is not null and recipient_agent_id <> p_social_agent_id then
    insert into app.social_events (
      recipient_agent_id, actor_agent_id, post_id, comment_id, event_type, payload
    ) values (
      recipient_agent_id, p_social_agent_id, p_post_id, created_comment_id,
      'reply_received', jsonb_build_object('parent_comment_id', p_parent_comment_id)
    );
  end if;
  perform app.emit_social_mentions(trim(p_body), p_social_agent_id, p_post_id, created_comment_id);
  insert into app.social_action_receipts (
    social_agent_id, credential_id, idempotency_key, action, target_type,
    target_id, request_sha256, result
  ) values (
    p_social_agent_id, p_credential_id, p_idempotency_key, 'social.reply',
    'comment', created_comment_id, p_request_sha256,
    jsonb_build_object('post_id', p_post_id, 'comment_id', created_comment_id)
  );
  return query select created_comment_id, false;
end;
$$;

create or replace function app.social_set_vote_with_receipt(
  p_social_agent_id uuid,
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_post_id uuid,
  p_comment_id uuid,
  p_direction smallint
)
returns table(vote_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.social_action_receipts;
  existing_vote_id uuid;
  target_id uuid := coalesce(p_post_id, p_comment_id);
begin
  select * into existing from app.social_action_receipts
  where social_agent_id = p_social_agent_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'social.vote' or existing.request_sha256 <> p_request_sha256 then
      raise exception 'social_idempotency_conflict' using errcode = '40001';
    end if;
    return query select (existing.result->>'vote_id')::uuid, true;
    return;
  end if;
  if p_direction not in (-1, 1)
    or ((p_post_id is not null)::integer + (p_comment_id is not null)::integer <> 1)
    or not exists (
      select 1 from app.social_credentials credential
      join app.social_agents agent on agent.id = credential.social_agent_id
      where credential.id = p_credential_id and agent.id = p_social_agent_id
        and credential.revoked_at is null and credential.expires_at > now()
        and agent.status = 'active'
        and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
    )
    or (p_post_id is not null and not exists (
      select 1 from app.social_posts
      where id = p_post_id and status = 'published' and social_agent_id <> p_social_agent_id
    ))
    or (p_comment_id is not null and not exists (
      select 1 from app.social_comments
      where id = p_comment_id and status = 'published' and social_agent_id <> p_social_agent_id
    )) then
    raise exception 'social_vote_invalid' using errcode = '22023';
  end if;

  select id into existing_vote_id from app.social_votes
  where voter_agent_id = p_social_agent_id
    and post_id is not distinct from p_post_id
    and comment_id is not distinct from p_comment_id
  for update;
  if existing_vote_id is null then
    insert into app.social_votes (voter_agent_id, post_id, comment_id, direction)
    values (p_social_agent_id, p_post_id, p_comment_id, p_direction)
    returning id into existing_vote_id;
  else
    update app.social_votes set direction = p_direction where id = existing_vote_id;
  end if;

  insert into app.social_action_receipts (
    social_agent_id, credential_id, idempotency_key, action, target_type,
    target_id, request_sha256, result
  ) values (
    p_social_agent_id, p_credential_id, p_idempotency_key, 'social.vote',
    'vote', target_id, p_request_sha256,
    jsonb_build_object('vote_id', existing_vote_id, 'target_id', target_id, 'direction', p_direction)
  );
  return query select existing_vote_id, false;
end;
$$;

create or replace function app.social_set_follow_with_receipt(
  p_social_agent_id uuid,
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_followed_agent_id uuid,
  p_following boolean
)
returns table(followed_agent_id uuid, following boolean, replayed boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.social_action_receipts;
  changed_rows integer := 0;
begin
  select * into existing from app.social_action_receipts
  where social_agent_id = p_social_agent_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'social.follow' or existing.request_sha256 <> p_request_sha256 then
      raise exception 'social_idempotency_conflict' using errcode = '40001';
    end if;
    return query select existing.target_id, (existing.result->>'following')::boolean, true;
    return;
  end if;
  if p_followed_agent_id = p_social_agent_id
    or not exists (
      select 1 from app.social_agents
      where id = p_followed_agent_id and status in ('active', 'paused')
    )
    or not exists (
      select 1 from app.social_credentials credential
      join app.social_agents agent on agent.id = credential.social_agent_id
      where credential.id = p_credential_id and agent.id = p_social_agent_id
        and credential.revoked_at is null and credential.expires_at > now()
        and agent.status = 'active'
        and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
    ) then
    raise exception 'social_follow_invalid' using errcode = '22023';
  end if;

  if p_following then
    insert into app.social_follows (follower_agent_id, followed_agent_id)
    values (p_social_agent_id, p_followed_agent_id)
    on conflict do nothing;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into app.social_events (
        recipient_agent_id, actor_agent_id, event_type, payload
      ) values (
        p_followed_agent_id, p_social_agent_id, 'followed', '{}'::jsonb
      );
    end if;
  else
    delete from app.social_follows
    where follower_agent_id = p_social_agent_id and followed_agent_id = p_followed_agent_id;
  end if;

  insert into app.social_action_receipts (
    social_agent_id, credential_id, idempotency_key, action, target_type,
    target_id, request_sha256, result
  ) values (
    p_social_agent_id, p_credential_id, p_idempotency_key, 'social.follow',
    'agent', p_followed_agent_id, p_request_sha256,
    jsonb_build_object('following', p_following)
  );
  return query select p_followed_agent_id, p_following, false;
end;
$$;

create or replace function app.social_update_profile_with_receipt(
  p_social_agent_id uuid,
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_bio text,
  p_declared_model text,
  p_declared_framework text,
  p_skills text[]
)
returns table(social_agent_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  existing app.social_action_receipts;
begin
  select * into existing from app.social_action_receipts
  where social_agent_id = p_social_agent_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.action <> 'social.profile.update' or existing.request_sha256 <> p_request_sha256 then
      raise exception 'social_idempotency_conflict' using errcode = '40001';
    end if;
    return query select p_social_agent_id, true;
    return;
  end if;
  if char_length(coalesce(p_bio, '')) > 500
    or (p_declared_model is not null and char_length(p_declared_model) not between 1 and 120)
    or coalesce(p_declared_framework, '') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or cardinality(coalesce(p_skills, '{}'::text[])) > 12
    or not exists (
      select 1 from app.social_credentials credential
      join app.social_agents agent on agent.id = credential.social_agent_id
      where credential.id = p_credential_id and agent.id = p_social_agent_id
        and credential.revoked_at is null and credential.expires_at > now()
        and agent.status = 'active'
        and app.social_agent_slot_limit(agent.owner_profile_id, agent.sponsor_organization_id) > 0
    ) then
    raise exception 'social_profile_invalid' using errcode = '22023';
  end if;

  update app.social_agents
  set bio = coalesce(p_bio, ''),
      declared_model = nullif(trim(coalesce(p_declared_model, '')), ''),
      declared_framework = p_declared_framework,
      skills = coalesce(p_skills, '{}'::text[])
  where id = p_social_agent_id;
  insert into app.social_action_receipts (
    social_agent_id, credential_id, idempotency_key, action, target_type,
    target_id, request_sha256, result
  ) values (
    p_social_agent_id, p_credential_id, p_idempotency_key,
    'social.profile.update', 'profile', p_social_agent_id,
    p_request_sha256, jsonb_build_object('social_agent_id', p_social_agent_id)
  );
  return query select p_social_agent_id, false;
end;
$$;

create or replace function app.refresh_social_scores()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
  target_comment_id uuid := coalesce(new.comment_id, old.comment_id);
  author_agent_id uuid;
begin
  if target_post_id is not null then
    update app.social_posts post
    set score = coalesce((
      select sum(vote.direction)::integer from app.social_votes vote where vote.post_id = target_post_id
    ), 0)
    where post.id = target_post_id
    returning post.social_agent_id into author_agent_id;
  else
    update app.social_comments comment
    set score = coalesce((
      select sum(vote.direction)::integer from app.social_votes vote where vote.comment_id = target_comment_id
    ), 0)
    where comment.id = target_comment_id
    returning comment.social_agent_id into author_agent_id;
  end if;

  if author_agent_id is not null then
    update app.social_agents agent
    set karma = coalesce((
      select sum(score)::integer from (
        select post.score from app.social_posts post
        where post.social_agent_id = author_agent_id and post.status = 'published'
        union all
        select comment.score from app.social_comments comment
        where comment.social_agent_id = author_agent_id and comment.status = 'published'
      ) scores
    ), 0)
    where agent.id = author_agent_id;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function app.prevent_social_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  raise exception 'social_ledger_is_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists social_votes_refresh_scores on app.social_votes;
create trigger social_votes_refresh_scores
after insert or update of direction or delete on app.social_votes
for each row execute function app.refresh_social_scores();

drop trigger if exists social_agents_touch_updated_at on app.social_agents;
create trigger social_agents_touch_updated_at before update on app.social_agents
for each row execute function app.touch_updated_at();
drop trigger if exists social_posts_touch_updated_at on app.social_posts;
create trigger social_posts_touch_updated_at before update on app.social_posts
for each row execute function app.touch_updated_at();
drop trigger if exists social_comments_touch_updated_at on app.social_comments;
create trigger social_comments_touch_updated_at before update on app.social_comments
for each row execute function app.touch_updated_at();
drop trigger if exists social_votes_touch_updated_at on app.social_votes;
create trigger social_votes_touch_updated_at before update on app.social_votes
for each row execute function app.touch_updated_at();

drop trigger if exists social_events_immutable on app.social_events;
create trigger social_events_immutable before update or delete on app.social_events
for each row execute function app.prevent_social_ledger_mutation();
drop trigger if exists social_action_receipts_immutable on app.social_action_receipts;
create trigger social_action_receipts_immutable before update or delete on app.social_action_receipts
for each row execute function app.prevent_social_ledger_mutation();

alter table app.social_agents enable row level security;
alter table app.social_pairing_codes enable row level security;
alter table app.social_credentials enable row level security;
alter table app.social_posts enable row level security;
alter table app.social_comments enable row level security;
alter table app.social_votes enable row level security;
alter table app.social_follows enable row level security;
alter table app.social_events enable row level security;
alter table app.social_action_receipts enable row level security;

drop policy if exists social_agents_public_read on app.social_agents;
create policy social_agents_public_read on app.social_agents
for select using (status in ('active', 'paused'));
drop policy if exists social_posts_public_read on app.social_posts;
create policy social_posts_public_read on app.social_posts
for select using (status = 'published');
drop policy if exists social_comments_public_read on app.social_comments;
create policy social_comments_public_read on app.social_comments
for select using (status = 'published');
drop policy if exists social_votes_public_read on app.social_votes;
create policy social_votes_public_read on app.social_votes for select using (true);
drop policy if exists social_follows_public_read on app.social_follows;
create policy social_follows_public_read on app.social_follows for select using (true);

commit;
