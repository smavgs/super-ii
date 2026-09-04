\set ON_ERROR_STOP on

begin;

do $$
declare
  proposer_id uuid;
  agent_owner_id uuid;
  voter_id uuid;
  proposal_row app.proposals;
  social_agent app.social_agents;
  human_vote record;
  agent_vote record;
  fame_order record;
  highlight_order record;
  repository_result record;
  rotated record;
  index integer;
begin
  proposer_id := app.ensure_profile(
    'participation-proposer', 'participation-proposer', 'Proposal Builder', null
  );
  agent_owner_id := app.ensure_profile(
    'participation-agent-owner', 'participation-agent-owner', 'Agent Operator', null
  );

  insert into app.subscriptions (
    clerk_user_id, plan_id, provider, provider_subscription_id, status, current_period_end
  ) values (
    'participation-agent-owner', 'pro', 'test', 'participation-agent-pro',
    'active', now() + interval '30 days'
  );
  social_agent := app.create_social_agent(
    agent_owner_id, null, 'proposal-scout', 'Proposal Scout',
    'A bounded proposal-vote integration test.', null, 'test-model', 'custom',
    array['roadmaps'], array['open-ai'], '{}'::text[], 'responsive', 2, 10, 300
  );
  update app.social_agents
  set status = 'active', paired_at = now()
  where id = social_agent.id;

  proposal_row := app.create_public_proposal(
    proposer_id,
    'participation-contract-smoke',
    'Make the participation contract testable',
    'Prove that human commitments and agent demand remain separate.',
    'This proposal exists only inside a rolled-back PostgreSQL integration test.'
  );

  select * into agent_vote from app.cast_agent_proposal_vote(
    proposal_row.id, social_agent.id, agent_owner_id
  );
  if agent_vote.agent_votes <> 1 or agent_vote.human_votes <> 0
    or agent_vote.proposal_status <> 'voting' or agent_vote.replayed then
    raise exception 'Agent vote did not remain a separate non-binding signal';
  end if;
  select * into agent_vote from app.cast_agent_proposal_vote(
    proposal_row.id, social_agent.id, agent_owner_id
  );
  if not agent_vote.replayed or agent_vote.agent_votes <> 1 then
    raise exception 'Agent vote idempotency failed';
  end if;

  begin
    perform app.cast_human_proposal_vote(
      proposal_row.id, proposer_id, encode(digest('self-vote', 'sha256'), 'hex')
    );
    raise exception 'Proposal self-vote was accepted';
  exception
    when insufficient_privilege then null;
  end;

  for index in 1..100 loop
    voter_id := app.ensure_profile(
      'participation-voter-' || index,
      'participation-voter-' || index,
      'Participation Voter ' || index,
      null
    );
    select * into human_vote from app.cast_human_proposal_vote(
      proposal_row.id,
      voter_id,
      encode(digest('participation-network-' || index, 'sha256'), 'hex')
    );
  end loop;

  if human_vote.human_votes <> 100 or human_vote.agent_votes <> 1
    or human_vote.proposal_status <> 'accepted' then
    raise exception '100 verified human votes did not accept the proposal';
  end if;
  select * into human_vote from app.cast_human_proposal_vote(
    proposal_row.id,
    voter_id,
    encode(digest('participation-network-100', 'sha256'), 'hex')
  );
  if not human_vote.replayed or human_vote.human_votes <> 100 then
    raise exception 'Human vote idempotency failed';
  end if;
  if (select acceptance_reason from app.proposals where id = proposal_row.id) <> 'human-threshold'
    or (select count(*) from app.proposal_status_history
        where proposal_id = proposal_row.id and to_status = 'accepted') <> 1 then
    raise exception 'Proposal acceptance audit history is incomplete';
  end if;

  perform app.report_proposal(proposal_row.id, voter_id, 'other', 'Smoke-test report.');
  if (select count(*) from app.proposal_reports where proposal_id = proposal_row.id) <> 1 then
    raise exception 'Community proposal reporting failed';
  end if;

  update app.proposal_votes
  set created_at = date_trunc('month', current_date) - interval '1 month' + interval '1 day'
  where proposal_id = proposal_row.id and vote_kind = 'human';
  if app.finalize_proposal_leaderboard(
    (date_trunc('month', current_date) - interval '1 month')::date
  ) <> 1 then
    raise exception 'Monthly Community Leader award was not finalized';
  end if;
  if not exists (
    select 1 from app.proposal_leader_badges
    where profile_id = proposer_id and rank = 1
      and winning_proposal_id = proposal_row.id and valid_human_votes = 100
  ) then
    raise exception 'Permanent Community Leader badge is incomplete';
  end if;

  proposal_row := app.set_proposal_status(
    proposal_row.id, proposer_id, 'building', 'Building the accepted proposal.'
  );
  proposal_row := app.set_proposal_status(
    proposal_row.id, proposer_id, 'shipped', 'Shipped after verification.'
  );
  if proposal_row.status <> 'shipped'
    or (select count(*) from app.proposal_status_history where proposal_id = proposal_row.id) <> 4 then
    raise exception 'Proposal roadmap status history is incomplete';
  end if;

  if (select count(*) from app.fame_slots) <> 200
    or (select min(slot_number) from app.fame_slots) <> 1
    or (select max(slot_number) from app.fame_slots) <> 200 then
    raise exception 'Founding 200 slot ledger is not exactly 001 through 200';
  end if;
  select * into fame_order from app.create_fame_checkout(proposer_id);
  if fame_order.slot_number <> 1 or fame_order.reused then
    raise exception 'Founding 200 did not reserve the first equal place';
  end if;
  perform app.apply_participation_payment_status(
    fame_order.order_id, 'participation-fame-payment', 'finished',
    '{"payment_status":"finished"}'::jsonb
  );
  if not exists (
    select 1 from app.fame_slots
    where order_id = fame_order.order_id and slot_number = 1 and status = 'active'
  ) then
    raise exception 'Paid Founding 200 place was not activated';
  end if;
  perform app.apply_participation_payment_status(
    fame_order.order_id, 'participation-fame-payment', 'refunded',
    '{"payment_status":"refunded"}'::jsonb
  );
  if not exists (
    select 1 from app.fame_slots
    where order_id = fame_order.order_id and slot_number = 1 and status = 'retired'
  ) then
    raise exception 'Refunded Founding 200 number was not permanently retired';
  end if;

  select * into repository_result from app.create_repository_with_revision(
    proposer_id, null, 'model', 'highlight-smoke', 'Highlight Smoke Model',
    'A reviewed public repository used to verify isolated paid discovery.',
    'apache-2.0', 'text-generation', 'test', 'text',
    '# Model Card', '{"origin":"integration-test"}'::jsonb
  );
  update app.repository_revisions set
    manifest_sha256 = repeat('a', 64),
    commit_sha = repeat('b', 64),
    status = 'published',
    published_at = now()
  where id = repository_result.revision_id;
  update app.repositories set
    status = 'published', published_at = now(), latest_revision_id = repository_result.revision_id
  where id = repository_result.repository_id;

  select * into highlight_order from app.create_highlight_checkout(
    proposer_id, repository_result.repository_id, 1
  );
  if highlight_order.reused then
    raise exception 'New Highlight checkout was unexpectedly reused';
  end if;
  perform app.apply_participation_payment_status(
    highlight_order.order_id, 'participation-highlight-payment', 'finished',
    '{"payment_status":"finished"}'::jsonb
  );
  select * into rotated from app.select_highlight_rotation('model', 8);
  if rotated.campaign_id <> highlight_order.campaign_id
    or rotated.repository_id <> repository_result.repository_id then
    raise exception 'Fair Highlight rotation did not return the active campaign';
  end if;
  if not app.record_highlight_event(
    highlight_order.campaign_id, 'impression', encode(digest('highlight-visitor', 'sha256'), 'hex')
  ) then
    raise exception 'First Highlight impression was not recorded';
  end if;
  if app.record_highlight_event(
    highlight_order.campaign_id, 'impression', encode(digest('highlight-visitor', 'sha256'), 'hex')
  ) then
    raise exception 'Duplicate daily Highlight impression was counted';
  end if;
  if (select impressions from app.highlight_campaigns where id = highlight_order.campaign_id) <> 1
    or (select count(*) from app.repository_downloads where repository_id = repository_result.repository_id) <> 0 then
    raise exception 'Highlight metrics leaked into organic repository signals';
  end if;
end;
$$;

rollback;
