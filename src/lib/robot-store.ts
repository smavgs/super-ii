import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AuthenticatedProfile } from './auth';
import { publicRobotDocument, type MakeRobotInput, type RobotPlan } from './robot';

export type RobotPlanTier = 'free' | 'pro' | 'team' | 'enterprise';

export type RobotRow = Record<string, unknown> & {
  id: string;
  owner_handle: string;
  owner_display_name: string;
  owner_type: 'person' | 'organization';
  slug: string;
  title: string;
  summary: string;
  audience: string;
  visibility: 'public' | 'private';
  status: 'draft' | 'published' | 'archived';
  version_id: string;
  version_number: number;
  change_summary: string;
  plan_snapshot: RobotPlan;
  created_at: string;
  updated_at: string;
  version_created_at: string;
};

export type RobotHardwareRow = {
  id: string;
  component_slug: string | null;
  custom_name: string | null;
  quantity: number;
  notes: string;
  status: string;
  owner_handle: string;
  owner_type: string;
  created_at: string;
  updated_at: string;
};

export async function activeRobotPlan(
  sql: NeonQueryFunction<false, false>,
  profile: AuthenticatedProfile,
): Promise<RobotPlanTier> {
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
              or subscription.clerk_organization_id = organization.clerk_organization_id
            )
        )
      )
    order by case subscription.plan_id when 'enterprise' then 3 when 'team' then 2 else 1 end desc
    limit 1
  `;
  const plan = rows[0]?.plan_id;
  return plan === 'pro' || plan === 'team' || plan === 'enterprise' ? plan : 'free';
}

const robotProjection = `
  robot.id, robot.slug, robot.title, robot.summary, robot.audience,
  robot.visibility, robot.status, robot.created_at, robot.updated_at,
  coalesce(profile.handle, organization.handle) as owner_handle,
  coalesce(profile.display_name, organization.name) as owner_display_name,
  case when robot.owner_profile_id is not null then 'person' else 'organization' end as owner_type,
  version.id as version_id, version.version_number, version.change_summary,
  version.plan_snapshot, version.created_at as version_created_at
`;

export async function listPublicRobots(
  sql: NeonQueryFunction<false, false>,
  input: { query?: string; limit?: number; offset?: number } = {},
): Promise<RobotRow[]> {
  const query = input.query?.trim().slice(0, 120) ?? '';
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50);
  const offset = Math.min(Math.max(Math.trunc(input.offset ?? 0), 0), 10_000);
  return await sql.query(
    `select ${robotProjection}
     from app.robots robot
     join app.robot_versions version on version.id = robot.latest_version_id
     left join app.profiles profile on profile.id = robot.owner_profile_id
     left join app.organizations organization on organization.id = robot.owner_organization_id
     where robot.visibility = 'public' and robot.status = 'published'
       and ($1 = '' or to_tsvector('simple', robot.title || ' ' || robot.summary || ' ' || robot.audience)
         @@ websearch_to_tsquery('simple', $1))
     order by robot.updated_at desc, robot.id
     limit $2 offset $3`,
    [query, limit, offset],
  ) as RobotRow[];
}

export async function getPublicRobot(
  sql: NeonQueryFunction<false, false>,
  owner: string,
  slug: string,
): Promise<RobotRow | null> {
  const rows = await sql.query(
    `select ${robotProjection}
     from app.robots robot
     join app.robot_versions version on version.id = robot.latest_version_id
     left join app.profiles profile on profile.id = robot.owner_profile_id
     left join app.organizations organization on organization.id = robot.owner_organization_id
     where robot.visibility = 'public' and robot.status = 'published'
       and lower(coalesce(profile.handle, organization.handle)) = lower($1)
       and lower(robot.slug) = lower($2)
     limit 1`,
    [owner, slug],
  ) as RobotRow[];
  return rows[0] ?? null;
}

export async function getAccessibleRobot(
  sql: NeonQueryFunction<false, false>,
  owner: string,
  slug: string,
  profileId: string | null,
): Promise<RobotRow | null> {
  const rows = await sql.query(
    `select ${robotProjection}
     from app.robots robot
     join app.robot_versions version on version.id = robot.latest_version_id
     left join app.profiles profile on profile.id = robot.owner_profile_id
     left join app.organizations organization on organization.id = robot.owner_organization_id
     where lower(coalesce(profile.handle, organization.handle)) = lower($1)
       and lower(robot.slug) = lower($2)
       and robot.status = 'published'
       and (
         robot.visibility = 'public'
         or robot.owner_profile_id = $3::uuid
         or exists (select 1 from app.organization_members member where member.organization_id = robot.owner_organization_id and member.profile_id = $3::uuid)
       )
     limit 1`,
    [owner, slug, profileId],
  ) as RobotRow[];
  return rows[0] ?? null;
}

export async function listRobotVersions(
  sql: NeonQueryFunction<false, false>,
  robotId: string,
) {
  return await sql`
    select version.id, version.version_number, version.change_summary, version.catalog_revision,
           version.plan_snapshot, version.created_at,
           profile.handle as creator_handle, agent.handle as agent_handle
    from app.robot_versions version
    join app.profiles profile on profile.id = version.created_by_profile_id
    left join app.agent_identities agent on agent.id = version.created_by_agent_id
    where version.robot_id = ${robotId}::uuid
    order by version.version_number desc
    limit 200
  `;
}

export async function listOwnedRobots(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<RobotRow[]> {
  return await sql.query(
    `select distinct ${robotProjection}
     from app.robots robot
     join app.robot_versions version on version.id = robot.latest_version_id
     left join app.profiles profile on profile.id = robot.owner_profile_id
     left join app.organizations organization on organization.id = robot.owner_organization_id
     left join app.organization_members member on member.organization_id = robot.owner_organization_id
     where robot.owner_profile_id = $1::uuid
        or (member.profile_id = $1::uuid and member.role in ('owner','admin','maintainer'))
     order by robot.updated_at desc
     limit 100`,
    [profileId],
  ) as RobotRow[];
}

export async function listHardware(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<RobotHardwareRow[]> {
  return await sql`
    select distinct hardware.id, hardware.component_slug, hardware.custom_name, hardware.quantity,
           hardware.notes, hardware.status, hardware.created_at, hardware.updated_at,
           coalesce(profile.handle, organization.handle) as owner_handle,
           case when hardware.owner_profile_id is not null then 'person' else 'organization' end as owner_type
    from app.robot_hardware hardware
    left join app.profiles profile on profile.id = hardware.owner_profile_id
    left join app.organizations organization on organization.id = hardware.owner_organization_id
    left join app.organization_members member on member.organization_id = hardware.owner_organization_id
    where hardware.archived_at is null and (
      hardware.owner_profile_id = ${profileId}::uuid
      or (member.profile_id = ${profileId}::uuid and member.role in ('owner','admin','maintainer'))
    )
    order by hardware.updated_at desc
    limit 200
  ` as RobotHardwareRow[];
}

export function robotJson(row: RobotRow, origin: string) {
  return publicRobotDocument(row, origin);
}

export type CreateRobotInput = {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  visibility: 'public' | 'private';
  organizationId: string | null;
  changeSummary: string;
  plannerInput: MakeRobotInput;
  plan: RobotPlan;
};
