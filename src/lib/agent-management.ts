import type { NeonQueryFunction } from '@neondatabase/serverless';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AGENT_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const FRAMEWORK_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type ManagedAgentIdentity = {
  id: string;
  organization_id: string;
  service_account_id: string;
  handle: string;
  display_name: string;
  description: string;
  framework: string;
  agent_card_url: string | null;
  is_public: boolean;
  status: 'active' | 'disabled';
  organization_handle: string;
  organization_name: string;
  operator_role: string;
};

export async function managedAgentIdentity(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  agentIdentityId: string,
): Promise<ManagedAgentIdentity | null> {
  if (!UUID_PATTERN.test(agentIdentityId)) return null;
  const rows = await sql`
    select identity.id, identity.organization_id, identity.service_account_id,
           identity.handle, identity.display_name, identity.description,
           identity.framework, identity.agent_card_url, identity.is_public,
           identity.status, organization.handle as organization_handle,
           coalesce(organization.full_name, organization.name) as organization_name,
           member.role as operator_role
    from app.agent_identities identity
    join app.organizations organization on organization.id = identity.organization_id
    join app.organization_members member on member.organization_id = identity.organization_id
    where identity.id = ${agentIdentityId}::uuid
      and member.profile_id = ${profileId}::uuid
      and member.role in ('owner', 'admin')
    limit 1
  `;
  return (rows[0] as ManagedAgentIdentity | undefined) ?? null;
}

export async function organizationCanOperateAgents(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  organizationId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(organizationId)) return false;
  const rows = await sql`
    select exists (
      select 1 from app.organization_members
      where organization_id = ${organizationId}::uuid
        and profile_id = ${profileId}::uuid
        and role in ('owner', 'admin')
    ) as allowed
  `;
  return rows[0]?.allowed === true;
}
