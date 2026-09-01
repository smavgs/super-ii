import type { NeonQueryFunction } from '@neondatabase/serverless';

export type PublicAgentProfile = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  framework: string;
  agent_card_url: string | null;
  verified_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  organization_handle: string;
  organization_name: string;
  organization_logo_url: string | null;
  accepted_contributions: number;
  rejected_contributions: number;
  successful_actions: number;
  reputation_score: number;
  contributions: Array<{
    submission_id: string;
    job_id: string;
    job_type: string;
    title: string;
    reward_label: string;
    repository_id: string | null;
    repository_owner: string | null;
    repository_slug: string | null;
    repository_kind: string | null;
    result_sha256: string;
    reviewed_at: string | null;
  }>;
  activity: Array<{
    cursor: number;
    event_type: string;
    payload: Record<string, unknown>;
    occurred_at: string;
  }>;
};

export async function getPublicAgentProfile(
  sql: NeonQueryFunction<false, false>,
  handle: string,
): Promise<PublicAgentProfile | null> {
  const identities = await sql`
    select identity.id, identity.handle, identity.display_name, identity.description,
           identity.framework, identity.agent_card_url, identity.verified_at,
           identity.last_seen_at, identity.created_at,
           organization.handle as organization_handle,
           coalesce(organization.full_name, organization.name) as organization_name,
           organization.logo_url as organization_logo_url,
           coalesce(reputation.accepted_contributions, 0)::integer as accepted_contributions,
           coalesce(reputation.rejected_contributions, 0)::integer as rejected_contributions,
           coalesce(reputation.successful_actions, 0)::integer as successful_actions,
           coalesce(reputation.reputation_score, 0)::integer as reputation_score
    from app.agent_identities identity
    join app.organizations organization on organization.id = identity.organization_id
    left join app.agent_reputation reputation on reputation.agent_identity_id = identity.id
    where lower(identity.handle) = lower(${handle})
      and identity.is_public and identity.status = 'active'
    limit 1
  `;
  const identity = identities[0];
  if (!identity?.id) return null;
  const [contributions, activity] = await Promise.all([
    sql`
      select submission.id as submission_id, submission.job_id,
             job.job_type, job.title, job.reward_label, job.repository_id,
             repository.owner_handle as repository_owner,
             repository.slug as repository_slug,
             repository.kind as repository_kind,
             submission.result_sha256, submission.reviewed_at
      from app.agent_contribution_submissions submission
      join app.agent_contribution_jobs job on job.id = submission.job_id
      left join app.repositories repository on repository.id = job.repository_id
      where submission.agent_identity_id = ${String(identity.id)}::uuid
        and submission.status = 'accepted'
      order by submission.reviewed_at desc nulls last
      limit 50
    `,
    sql`
      select cursor, event_type, payload, occurred_at
      from app.agent_events
      where agent_identity_id = ${String(identity.id)}::uuid
        and visibility = 'public'
      order by cursor desc
      limit 50
    `,
  ]);
  return {
    ...(identity as Omit<PublicAgentProfile, 'contributions' | 'activity'>),
    accepted_contributions: Number(identity.accepted_contributions ?? 0),
    rejected_contributions: Number(identity.rejected_contributions ?? 0),
    successful_actions: Number(identity.successful_actions ?? 0),
    reputation_score: Number(identity.reputation_score ?? 0),
    contributions: contributions as PublicAgentProfile['contributions'],
    activity: activity.map((event) => ({
      ...event,
      cursor: Number(event.cursor),
    })) as PublicAgentProfile['activity'],
  };
}

export function publicAgentDocument(profile: PublicAgentProfile, origin: string) {
  return {
    schema_version: '1.0.0',
    identity: {
      id: profile.id,
      handle: profile.handle,
      display_name: profile.display_name,
      description: profile.description,
      framework: profile.framework,
      agent_card_url: profile.agent_card_url,
      verified_at: profile.verified_at,
      last_seen_at: profile.last_seen_at,
      created_at: profile.created_at,
    },
    operator: {
      type: 'organization',
      handle: profile.organization_handle,
      name: profile.organization_name,
      url: new URL(`/organizations/${encodeURIComponent(profile.organization_handle)}`, origin).toString(),
    },
    reputation: {
      score: profile.reputation_score,
      accepted_contributions: profile.accepted_contributions,
      rejected_contributions: profile.rejected_contributions,
      successful_actions: profile.successful_actions,
      interpretation: 'Reputation counts only human-reviewed accepted contribution jobs. It is not a claim of model quality or general trustworthiness.',
    },
    accepted_contributions: profile.contributions,
    public_activity: profile.activity,
    representations: {
      html: new URL(`/agents/${encodeURIComponent(profile.handle)}`, origin).toString(),
      json: new URL(`/agents/${encodeURIComponent(profile.handle)}/profile.json`, origin).toString(),
      markdown: new URL(`/agents/${encodeURIComponent(profile.handle)}/README.md`, origin).toString(),
    },
    boundaries: {
      raw_tokens_public: false,
      operator_receipts_public: false,
      accepted_contributions_human_reviewed: true,
    },
  };
}
