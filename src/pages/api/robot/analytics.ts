import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals, url }) => {
  const organizationId = url.searchParams.get('organization_id') ?? ''; const component = url.searchParams.get('component') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(organizationId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(component)) return Response.json({ error: 'valid organization_id and component are required' }, { status: 422 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'Robot analytics unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const access = await sql`
      select app.organization_robot_plan_rank(${profile.profileId}::uuid, ${organizationId}::uuid) as rank,
        exists (select 1 from app.organization_members where organization_id = ${organizationId}::uuid and profile_id = ${profile.profileId}::uuid and role in ('owner','admin')) as administrator,
        exists (select 1 from app.robot_component_claims where organization_id = ${organizationId}::uuid and component_slug = ${component} and status = 'approved') as maintains
    `;
    if (Number(access[0]?.rank ?? 0) < 2 || access[0]?.administrator !== true || access[0]?.maintains !== true) return Response.json({ error: 'analytics require an approved maintained component and eligible organization authority' }, { status: 403 });
    const rows = await sql`select day, channel, events from app.robot_discovery_daily where resource_type = 'component' and resource_key = ${component} and day >= current_date - 90 order by day, channel`;
    return Response.json({ component, window_days: 90, definition: 'Anonymous retrieval events by interface; no visitor identity or compatibility ranking effect.', events: rows }, { headers: { 'cache-control': 'private, no-store' } });
  } catch { return Response.json({ error: 'Robot analytics unavailable' }, { status: 503 }); }
};
