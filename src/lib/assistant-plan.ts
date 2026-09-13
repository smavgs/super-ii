import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AuthenticatedProfile } from './auth';

export type AssistantPlan = 'free' | 'pro' | 'team' | 'enterprise';

const GIB = 1024 ** 3;

export const assistantPlanEntitlements: Record<AssistantPlan, {
  persistentHistory: boolean;
  searchableHistory: boolean;
  selectableMemory: boolean;
  storageLimitBytes: number | null;
}> = {
  free: {
    persistentHistory: false,
    searchableHistory: false,
    selectableMemory: false,
    storageLimitBytes: null,
  },
  pro: {
    persistentHistory: true,
    searchableHistory: true,
    selectableMemory: true,
    storageLimitBytes: 25 * GIB,
  },
  team: {
    persistentHistory: true,
    searchableHistory: true,
    selectableMemory: true,
    storageLimitBytes: 50 * GIB,
  },
  enterprise: {
    persistentHistory: true,
    searchableHistory: true,
    selectableMemory: true,
    // Enterprise storage is contract-defined. Until a contract-specific limit
    // is represented in the database, retain the Team ceiling instead of
    // silently treating a custom plan as unlimited.
    storageLimitBytes: 50 * GIB,
  },
};

export async function activeAssistantPlan(
  sql: NeonQueryFunction<false, false>,
  profile: AuthenticatedProfile,
): Promise<AssistantPlan> {
  const rows = await sql`
    select subscription.plan_id
    from app.subscriptions subscription
    where subscription.status = 'active'
      and (subscription.current_period_end is null or subscription.current_period_end > now())
      and subscription.plan_id in ('pro', 'team', 'enterprise')
      and (
        subscription.clerk_user_id = ${profile.clerkUserId}
        or exists (
          select 1
          from app.organization_members member
          join app.organizations organization on organization.id = member.organization_id
          where member.profile_id = ${profile.profileId}::uuid
            and (
              subscription.organization_id = organization.id
              or (
                subscription.clerk_organization_id is not null
                and subscription.clerk_organization_id = organization.clerk_organization_id
              )
            )
        )
      )
    order by case subscription.plan_id when 'enterprise' then 3 when 'team' then 2 else 1 end desc
    limit 1
  `;
  const plan = rows[0]?.plan_id;
  return plan === 'enterprise' || plan === 'team' || plan === 'pro' ? plan : 'free';
}

export function assistantStorageLimit(plan: AssistantPlan): number | null {
  return assistantPlanEntitlements[plan].storageLimitBytes;
}
