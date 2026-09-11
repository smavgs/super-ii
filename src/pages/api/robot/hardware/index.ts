import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { robotHardwareInputSchema } from '@/lib/robot';
import { activeRobotPlan, listHardware } from '@/lib/robot-store';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'hardware inventory unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    if (await activeRobotPlan(sql, profile) === 'free') return Response.json({ error: 'My Hardware requires Pro or an eligible Team plan' }, { status: 403 });
    return Response.json({ hardware: await listHardware(sql, profile.profileId) }, { headers: { 'cache-control': 'private, no-store' } });
  } catch { return Response.json({ error: 'hardware inventory unavailable' }, { status: 503 }); }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'hardware inventory unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'robot.hardware-create', 100, 86400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'hardware inventory limit reached' : 'inventory safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  const body = await readBoundedJsonObject(request, 8192); if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = robotHardwareInputSchema.safeParse(body.value); if (!parsed.success) return Response.json({ error: 'invalid hardware item', issues: parsed.error.issues }, { status: 422 });
  try {
    const plan = await activeRobotPlan(sql, profile); if (plan === 'free') return Response.json({ error: 'My Hardware requires Pro' }, { status: 403 });
    const item = parsed.data;
    if (item.organization_id) {
      const allowed = await sql`select app.organization_robot_plan_rank(${profile.profileId}::uuid, ${item.organization_id}::uuid) as rank`;
      if (Number(allowed[0]?.rank ?? 0) < 2) return Response.json({ error: 'Shared hardware inventory requires Team and a matching organization role' }, { status: 403 });
    }
    const rows = await sql`
      insert into app.robot_hardware (owner_profile_id, owner_organization_id, component_slug, custom_name, quantity, notes, status, created_by_profile_id)
      values (case when ${item.organization_id}::uuid is null then ${profile.profileId}::uuid end, ${item.organization_id}::uuid, ${item.component_slug}, ${item.custom_name}, ${item.quantity}, ${item.notes}, ${item.status}, ${profile.profileId}::uuid)
      returning id
    `;
    return Response.json({ ok: true, hardware_id: rows[0]?.id }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'hardware item could not be saved' }, { status: 409 }); }
};
