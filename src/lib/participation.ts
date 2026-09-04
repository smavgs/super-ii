import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { RepositoryKind } from './catalog';

export type ProposalStatus = 'voting' | 'accepted' | 'building' | 'shipped';

export type ProposalSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: ProposalStatus;
  proposer_handle: string;
  proposer_name: string;
  proposer_avatar_url: string | null;
  human_votes: number;
  agent_votes: number;
  human_vote_threshold: number;
  agent_vote_threshold: number;
  viewer_voted: boolean;
  created_at: string;
  updated_at: string;
};

export type ProposalDetail = ProposalSummary & {
  body: string;
  acceptance_reason: string | null;
  accepted_at: string | null;
  building_at: string | null;
  shipped_at: string | null;
  history: Array<{
    from_status: string | null;
    to_status: string;
    reason: string;
    created_at: string;
  }>;
};

export type CommunityLeader = {
  profile_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  valid_human_votes: number;
  shipped_count: number;
  winning_proposal_slug: string;
  winning_proposal_title: string;
};

export type LeaderBadge = CommunityLeader & {
  rank: 1 | 2 | 3;
  award_month: string;
};

export type FamePlace = {
  slot_number: number;
  status: 'open' | 'reserved' | 'active' | 'retired';
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  activated_at: string | null;
};

export type HighlightItem = {
  campaign_id: string;
  repository_id: string;
  kind: RepositoryKind;
  owner_handle: string;
  creator_handle: string;
  slug: string;
  title: string;
  summary: string;
  license: string | null;
  ends_at: string;
};

export type OwnedHighlight = HighlightItem & {
  order_id: string;
  duration_days: number;
  state: string;
  starts_at: string | null;
  impressions: number;
  profile_views: number;
  repository_opens: number;
  downloads: number;
};

export type EligibleHighlightRepository = {
  repository_id: string;
  kind: RepositoryKind;
  owner_handle: string;
  slug: string;
  title: string;
};

const numberValue = (value: unknown): number => Number(value ?? 0);

function proposalFromRow(row: Record<string, unknown>): ProposalSummary {
  return {
    ...row,
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status) as ProposalStatus,
    proposer_handle: String(row.proposer_handle),
    proposer_name: String(row.proposer_name),
    proposer_avatar_url: row.proposer_avatar_url ? String(row.proposer_avatar_url) : null,
    human_votes: numberValue(row.human_votes),
    agent_votes: numberValue(row.agent_votes),
    human_vote_threshold: numberValue(row.human_vote_threshold),
    agent_vote_threshold: numberValue(row.agent_vote_threshold),
    viewer_voted: row.viewer_voted === true,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getProposalBoard(
  sql: NeonQueryFunction<false, false>,
  viewerProfileId: string | null,
  status: ProposalStatus | null = null,
): Promise<ProposalSummary[]> {
  const rows = await sql`
    select proposal.id, proposal.slug, proposal.title, proposal.summary, proposal.status,
           proposal.human_vote_threshold, proposal.agent_vote_threshold,
           proposal.created_at, proposal.updated_at,
           profile.handle as proposer_handle, profile.display_name as proposer_name,
           profile.avatar_url as proposer_avatar_url,
           count(vote.id) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid') as human_votes,
           count(vote.id) filter (where vote.vote_kind = 'agent' and vote.risk_state = 'valid') as agent_votes,
           bool_or(vote.vote_kind = 'human' and vote.voter_profile_id = ${viewerProfileId}::uuid
             and vote.risk_state <> 'removed') as viewer_voted
    from app.proposals proposal
    join app.profiles profile on profile.id = proposal.proposer_profile_id and profile.is_public
    left join app.proposal_votes vote on vote.proposal_id = proposal.id
    where proposal.status <> 'removed'
      and (${status}::text is null or proposal.status = ${status})
    group by proposal.id, profile.id
    order by
      case proposal.status when 'voting' then 1 when 'accepted' then 2 when 'building' then 3 else 4 end,
      count(vote.id) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid') desc,
      proposal.created_at desc
    limit 200
  `;
  return rows.map((row) => proposalFromRow(row as Record<string, unknown>));
}

export async function getProposalBySlug(
  sql: NeonQueryFunction<false, false>,
  slug: string,
  viewerProfileId: string | null,
): Promise<ProposalDetail | null> {
  const rows = await sql`
    select proposal.*, profile.handle as proposer_handle,
           profile.display_name as proposer_name, profile.avatar_url as proposer_avatar_url,
           count(vote.id) filter (where vote.vote_kind = 'human' and vote.risk_state = 'valid') as human_votes,
           count(vote.id) filter (where vote.vote_kind = 'agent' and vote.risk_state = 'valid') as agent_votes,
           bool_or(vote.vote_kind = 'human' and vote.voter_profile_id = ${viewerProfileId}::uuid
             and vote.risk_state <> 'removed') as viewer_voted
    from app.proposals proposal
    join app.profiles profile on profile.id = proposal.proposer_profile_id and profile.is_public
    left join app.proposal_votes vote on vote.proposal_id = proposal.id
    where proposal.slug = ${slug} and proposal.status <> 'removed'
    group by proposal.id, profile.id
    limit 1
  `;
  if (!rows[0]) return null;
  const history = await sql`
    select from_status, to_status, reason, created_at
    from app.proposal_status_history
    where proposal_id = ${String(rows[0].id)}::uuid
    order by created_at asc
  `;
  return {
    ...proposalFromRow(rows[0] as Record<string, unknown>),
    body: String(rows[0].body ?? ''),
    acceptance_reason: rows[0].acceptance_reason ? String(rows[0].acceptance_reason) : null,
    accepted_at: rows[0].accepted_at ? String(rows[0].accepted_at) : null,
    building_at: rows[0].building_at ? String(rows[0].building_at) : null,
    shipped_at: rows[0].shipped_at ? String(rows[0].shipped_at) : null,
    history: history.map((row) => ({
      from_status: row.from_status ? String(row.from_status) : null,
      to_status: String(row.to_status),
      reason: String(row.reason ?? ''),
      created_at: String(row.created_at),
    })),
  };
}

export async function getCommunityLeaders(
  sql: NeonQueryFunction<false, false>,
  period: 'month' | 'all',
  limit = 20,
): Promise<CommunityLeader[]> {
  const since = period === 'month' ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() : null;
  const rows = await sql`
    with proposal_scores as (
      select proposal.id, proposal.slug, proposal.title, proposal.proposer_profile_id,
             count(vote.id)::integer as votes
      from app.proposals proposal
      join app.proposal_votes vote on vote.proposal_id = proposal.id
        and vote.vote_kind = 'human' and vote.risk_state = 'valid'
        and (${since}::timestamptz is null or vote.created_at >= ${since}::timestamptz)
      where proposal.status <> 'removed'
      group by proposal.id
    ), profile_scores as (
      select proposer_profile_id, sum(votes)::integer as valid_human_votes
      from proposal_scores group by proposer_profile_id
    )
    select profile.id as profile_id, profile.handle, profile.display_name, profile.avatar_url,
           score.valid_human_votes,
           (select count(*)::integer from app.proposals shipped
             where shipped.proposer_profile_id = profile.id and shipped.status = 'shipped') as shipped_count,
           winner.slug as winning_proposal_slug, winner.title as winning_proposal_title
    from profile_scores score
    join app.profiles profile on profile.id = score.proposer_profile_id and profile.is_public
    cross join lateral (
      select proposal.slug, proposal.title from proposal_scores proposal
      where proposal.proposer_profile_id = profile.id
      order by proposal.votes desc, proposal.id limit 1
    ) winner
    order by score.valid_human_votes desc, profile.created_at asc
    limit ${Math.max(1, Math.min(100, limit))}
  `;
  return rows.map((row) => ({
    profile_id: String(row.profile_id),
    handle: String(row.handle),
    display_name: String(row.display_name),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    valid_human_votes: numberValue(row.valid_human_votes),
    shipped_count: numberValue(row.shipped_count),
    winning_proposal_slug: String(row.winning_proposal_slug),
    winning_proposal_title: String(row.winning_proposal_title),
  }));
}

export async function getPermanentLeaderBadges(
  sql: NeonQueryFunction<false, false>,
  limit = 30,
): Promise<LeaderBadge[]> {
  const rows = await sql`
    select badge.rank, badge.award_month, badge.valid_human_votes,
           profile.id as profile_id, profile.handle, profile.display_name, profile.avatar_url,
           proposal.slug as winning_proposal_slug, proposal.title as winning_proposal_title,
           (select count(*)::integer from app.proposals shipped
             where shipped.proposer_profile_id = profile.id and shipped.status = 'shipped') as shipped_count
    from app.proposal_leader_badges badge
    join app.profiles profile on profile.id = badge.profile_id and profile.is_public
    join app.proposals proposal on proposal.id = badge.winning_proposal_id
    order by badge.award_month desc, badge.rank asc
    limit ${Math.max(1, Math.min(100, limit))}
  `;
  return rows.map((row) => ({
    profile_id: String(row.profile_id),
    handle: String(row.handle),
    display_name: String(row.display_name),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    valid_human_votes: numberValue(row.valid_human_votes),
    shipped_count: numberValue(row.shipped_count),
    winning_proposal_slug: String(row.winning_proposal_slug),
    winning_proposal_title: String(row.winning_proposal_title),
    rank: numberValue(row.rank) as 1 | 2 | 3,
    award_month: String(row.award_month),
  }));
}

export async function getFameBoard(
  sql: NeonQueryFunction<false, false>,
): Promise<FamePlace[]> {
  const rows = await sql`
    select slot.slot_number, slot.status,
           case when slot.status = 'active' and profile.is_public then profile.handle end as handle,
           case when slot.status = 'active' and profile.is_public then profile.display_name end as display_name,
           case when slot.status = 'active' and profile.is_public then profile.avatar_url end as avatar_url,
           case when slot.status = 'active' and profile.is_public then slot.activated_at end as activated_at
    from app.fame_slots slot
    left join app.profiles profile on profile.id = slot.profile_id
    order by slot.slot_number
  `;
  return rows.map((row) => ({
    slot_number: numberValue(row.slot_number),
    status: String(row.status) as FamePlace['status'],
    handle: row.handle ? String(row.handle) : null,
    display_name: row.display_name ? String(row.display_name) : null,
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    activated_at: row.activated_at ? String(row.activated_at) : null,
  }));
}

export async function getRotatedHighlights(
  sql: NeonQueryFunction<false, false>,
  kind: RepositoryKind,
  limit = 8,
): Promise<HighlightItem[]> {
  const rows = await sql`
    select * from app.select_highlight_rotation(
      ${kind}::repository_kind, ${Math.max(1, Math.min(12, limit))}
    )
  `;
  return rows.map((row) => ({
    campaign_id: String(row.campaign_id),
    repository_id: String(row.repository_id),
    kind: String(row.kind) as RepositoryKind,
    owner_handle: String(row.owner_handle),
    creator_handle: String(row.creator_handle),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    license: row.license ? String(row.license) : null,
    ends_at: String(row.ends_at),
  }));
}

export async function getAllActiveHighlights(
  sql: NeonQueryFunction<false, false>,
  kind: RepositoryKind | null = null,
): Promise<HighlightItem[]> {
  const rows = await sql`
    select campaign.id as campaign_id, repository.id as repository_id,
           repository.kind, repository.owner_handle, profile.handle as creator_handle,
           repository.slug, repository.title, repository.summary, repository.license,
           campaign.ends_at
    from app.highlight_campaigns campaign
    join app.participation_orders payment on payment.id = campaign.order_id and payment.status = 'finished'
    join app.repositories repository on repository.id = campaign.repository_id
    join app.profiles profile on profile.id = campaign.profile_id and profile.is_public
    join app.repository_branches branch on branch.repository_id = repository.id and branch.is_default
    join app.repository_revisions revision on revision.id = branch.head_revision_id and revision.status = 'published'
    where campaign.state = 'active' and campaign.starts_at <= now() and campaign.ends_at > now()
      and repository.visibility = 'public' and repository.status = 'published'
      and (${kind}::repository_kind is null or repository.kind = ${kind}::repository_kind)
    order by campaign.created_at asc, campaign.id
    limit 1000
  `;
  return rows.map((row) => ({
    campaign_id: String(row.campaign_id),
    repository_id: String(row.repository_id),
    kind: String(row.kind) as RepositoryKind,
    owner_handle: String(row.owner_handle),
    creator_handle: String(row.creator_handle),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    license: row.license ? String(row.license) : null,
    ends_at: String(row.ends_at),
  }));
}

export async function getOwnedHighlights(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<OwnedHighlight[]> {
  const rows = await sql`
    select campaign.id as campaign_id, campaign.order_id, campaign.duration_days,
           campaign.state, campaign.starts_at, campaign.ends_at,
           campaign.impressions, campaign.profile_views, campaign.repository_opens, campaign.downloads,
           repository.id as repository_id, repository.kind, repository.owner_handle,
           profile.handle as creator_handle, repository.slug, repository.title,
           repository.summary, repository.license
    from app.highlight_campaigns campaign
    join app.repositories repository on repository.id = campaign.repository_id
    join app.profiles profile on profile.id = campaign.profile_id
    where campaign.profile_id = ${profileId}::uuid
    order by campaign.created_at desc limit 50
  `;
  return rows.map((row) => ({
    campaign_id: String(row.campaign_id),
    order_id: String(row.order_id),
    repository_id: String(row.repository_id),
    kind: String(row.kind) as RepositoryKind,
    owner_handle: String(row.owner_handle),
    creator_handle: String(row.creator_handle),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    license: row.license ? String(row.license) : null,
    duration_days: numberValue(row.duration_days),
    state: String(row.state),
    starts_at: row.starts_at ? String(row.starts_at) : null,
    ends_at: row.ends_at ? String(row.ends_at) : '',
    impressions: numberValue(row.impressions),
    profile_views: numberValue(row.profile_views),
    repository_opens: numberValue(row.repository_opens),
    downloads: numberValue(row.downloads),
  }));
}

export async function getEligibleHighlightRepositories(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<EligibleHighlightRepository[]> {
  const rows = await sql`
    select repository.id as repository_id, repository.kind, repository.owner_handle,
           repository.slug, repository.title
    from app.repositories repository
    join app.repository_branches branch on branch.repository_id = repository.id and branch.is_default
    join app.repository_revisions revision on revision.id = branch.head_revision_id and revision.status = 'published'
    where repository.visibility = 'public' and repository.status = 'published'
      and (
        repository.owner_profile_id = ${profileId}::uuid
        or exists (
          select 1 from app.organization_members member
          where member.organization_id = repository.owner_organization_id
            and member.profile_id = ${profileId}::uuid
            and member.role in ('owner', 'admin', 'maintainer')
        )
      )
    order by repository.kind, repository.owner_handle, repository.slug
  `;
  return rows.map((row) => ({
    repository_id: String(row.repository_id),
    kind: String(row.kind) as RepositoryKind,
    owner_handle: String(row.owner_handle),
    slug: String(row.slug),
    title: String(row.title),
  }));
}

export function publicRepositoryPath(item: Pick<HighlightItem, 'kind' | 'owner_handle' | 'slug'>): string {
  const section = item.kind === 'model' ? 'models' : item.kind === 'dataset' ? 'datasets' : 'spaces';
  return `/${section}/${encodeURIComponent(item.owner_handle)}/${encodeURIComponent(item.slug)}`;
}
