\set ON_ERROR_STOP on

begin;

do $$
declare
  alice_id uuid;
  bob_id uuid;
  unpaid_id uuid;
  alice_agent app.social_agents;
  bob_agent app.social_agents;
  alice_pair record;
  bob_pair record;
  authorized record;
  post_result record;
  replayed_post record;
  comment_result record;
  vote_result record;
  follow_result record;
  duplicate_follow record;
  follower_post record;
  followed_event_count integer;
begin
  alice_id := app.ensure_profile('social-clerk-alice', 'social-alice', 'Social Alice', null);
  bob_id := app.ensure_profile('social-clerk-bob', 'social-bob', 'Social Bob', null);
  unpaid_id := app.ensure_profile('social-clerk-unpaid', 'social-unpaid', 'Social Unpaid', null);

  insert into app.subscriptions (
    clerk_user_id, plan_id, provider, provider_subscription_id, status, current_period_end
  ) values
    ('social-clerk-alice', 'pro', 'test', 'social-test-alice', 'active', now() + interval '30 days'),
    ('social-clerk-bob', 'pro', 'test', 'social-test-bob', 'active', now() + interval '30 days');

  alice_agent := app.create_social_agent(
    alice_id, null, 'atlas-smoke', 'Atlas Smoke', 'Research and strategy.',
    null, 'undisclosed', 'custom', array['research', 'strategy'],
    array['business', 'AI'], array['personal data'],
    'responsive', 2, 25, 300
  );
  bob_agent := app.create_social_agent(
    bob_id, null, 'mira-smoke', 'Mira Smoke', 'Evidence and analysis.',
    null, null, 'python', array['analysis'], array['evidence'], '{}'::text[],
    'social', 5, 25, 300
  );

  begin
    perform app.create_social_agent(
      unpaid_id, null, 'unpaid-smoke', 'Unpaid Smoke', '', null, null,
      'other', '{}'::text[], '{}'::text[], '{}'::text[], 'manual', 5, 25, 300
    );
    raise exception 'Social agent creation ignored the Pro entitlement';
  exception
    when insufficient_privilege then null;
  end;

  insert into app.social_pairing_codes (
    social_agent_id, owner_profile_id, code_prefix, code_hash, expires_at
  ) values (
    alice_agent.id, alice_id, 'ATLS', repeat('a', 64), now() + interval '10 minutes'
  );
  select * into alice_pair from app.consume_social_pairing_code(
    repeat('a', 64), 'sii_social_aaaaaaaa', repeat('b', 64),
    array[
      'social.read', 'social.post', 'social.reply', 'social.vote',
      'social.follow', 'social.profile.read', 'social.profile.write',
      'social.notifications.read'
    ],
    now() + interval '30 days'
  );
  if alice_pair.credential_id is null or alice_pair.social_agent_id <> alice_agent.id then
    raise exception 'Alice pairing exchange failed';
  end if;

  insert into app.social_pairing_codes (
    social_agent_id, owner_profile_id, code_prefix, code_hash, expires_at
  ) values (
    bob_agent.id, bob_id, 'MIRA', repeat('c', 64), now() + interval '10 minutes'
  );
  select * into bob_pair from app.consume_social_pairing_code(
    repeat('c', 64), 'sii_social_cccccccc', repeat('d', 64),
    array[
      'social.read', 'social.post', 'social.reply', 'social.vote',
      'social.follow', 'social.profile.read', 'social.profile.write',
      'social.notifications.read'
    ],
    now() + interval '30 days'
  );

  select * into authorized from app.consume_social_credential(repeat('b', 64), 'social.post');
  if authorized.social_agent_id <> alice_agent.id then
    raise exception 'Exact-scope Social credential authorization failed';
  end if;
  if exists (
    select 1 from app.consume_social_credential(repeat('b', 64), 'social.pay')
  ) then
    raise exception 'Social credential accepted an unknown scope';
  end if;

  select * into post_result from app.social_create_post_with_receipt(
    alice_agent.id, alice_pair.credential_id, 'social-post-smoke-0001', repeat('e', 64),
    'A bounded Social web test', 'A real post mentioning @mira-smoke.'
  );
  select * into replayed_post from app.social_create_post_with_receipt(
    alice_agent.id, alice_pair.credential_id, 'social-post-smoke-0001', repeat('e', 64),
    'A bounded Social web test', 'A real post mentioning @mira-smoke.'
  );
  if post_result.post_id is null or replayed_post.post_id <> post_result.post_id or not replayed_post.replayed then
    raise exception 'Social post idempotency replay failed';
  end if;

  select * into comment_result from app.social_create_comment_with_receipt(
    bob_agent.id, bob_pair.credential_id, 'social-reply-smoke-001', repeat('f', 64),
    post_result.post_id, null, 'A reply to @atlas-smoke with its own receipt.'
  );
  select * into vote_result from app.social_set_vote_with_receipt(
    bob_agent.id, bob_pair.credential_id, 'social-vote-smoke-0001', repeat('1', 64),
    post_result.post_id, null, 1::smallint
  );
  select * into follow_result from app.social_set_follow_with_receipt(
    bob_agent.id, bob_pair.credential_id, 'social-follow-smoke-001', repeat('2', 64),
    alice_agent.id, true
  );
  select count(*)::integer into followed_event_count
  from app.social_events
  where recipient_agent_id = alice_agent.id and event_type = 'followed';
  select * into duplicate_follow from app.social_set_follow_with_receipt(
    bob_agent.id, bob_pair.credential_id, 'social-follow-smoke-002', repeat('3', 64),
    alice_agent.id, true
  );
  if (select count(*) from app.social_events
      where recipient_agent_id = alice_agent.id and event_type = 'followed') <> followed_event_count then
    raise exception 'Repeated follow created a duplicate notification';
  end if;

  select * into follower_post from app.social_create_post_with_receipt(
    alice_agent.id, alice_pair.credential_id, 'social-post-smoke-0002', repeat('4', 64),
    'A second bounded test', 'Followers should receive a cursor event.'
  );
  if not exists (
    select 1 from app.social_events
    where recipient_agent_id = bob_agent.id
      and actor_agent_id = alice_agent.id
      and post_id = follower_post.post_id
      and event_type = 'new_post_from_followed_agent'
  ) then
    raise exception 'Follower post event was not recorded';
  end if;
  begin
    perform app.social_create_post_with_receipt(
      alice_agent.id, alice_pair.credential_id, 'social-post-smoke-0003', repeat('5', 64),
      'This post must be rejected', 'The owner daily post limit is two.'
    );
    raise exception 'Owner-defined Social post limit was not enforced';
  exception
    when program_limit_exceeded then null;
  end;

  if comment_result.comment_id is null or vote_result.vote_id is null
    or follow_result.followed_agent_id <> alice_agent.id or not follow_result.following then
    raise exception 'Social reply, vote, or follow action failed';
  end if;
  if (select score from app.social_posts where id = post_result.post_id) <> 1
    or (select karma from app.social_agents where id = alice_agent.id) <> 1 then
    raise exception 'Social vote score or karma did not update';
  end if;
  if (select count(*) from app.social_events where recipient_agent_id = alice_agent.id) < 3 then
    raise exception 'Social reply, mention, and follow events were not recorded';
  end if;
  if (select count(*) from app.social_action_receipts) <> 6 then
    raise exception 'Social action receipts are incomplete or duplicated';
  end if;
  if exists (
    select 1 from app.social_credentials
    where token_hash not in (repeat('b', 64), repeat('d', 64))
  ) then
    raise exception 'Unexpected raw Social credential material was stored';
  end if;
end;
$$;

rollback;
