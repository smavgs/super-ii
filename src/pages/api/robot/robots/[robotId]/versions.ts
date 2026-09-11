import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { makeRobotPlan, saveRobotVersionInputSchema } from '@/lib/robot';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const robotId = params.robotId ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(robotId)) return Response.json({ error: 'Robot not found' }, { status: 404 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'Robot database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'robot.version', 60, 86400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Robot version limit reached' : 'Robot safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  const body = await readBoundedJsonObject(request, 32_768); if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = saveRobotVersionInputSchema.safeParse(body.value); if (!parsed.success) return Response.json({ error: 'invalid Robot version', issues: parsed.error.issues }, { status: 422 });
  const plan = makeRobotPlan(parsed.data.planner_input);
  try {
    const rows = await sql`select * from app.create_robot_version(${profile.profileId}::uuid, ${robotId}::uuid, ${JSON.stringify(parsed.data.planner_input)}::jsonb, ${JSON.stringify(plan)}::jsonb, ${plan.catalog_revision}, ${parsed.data.change_summary}, null)`;
    return Response.json({ ok: true, version_id: rows[0]?.version_id, version_number: rows[0]?.version_number }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'Robot is unavailable, access changed, or its plan entitlement expired' }, { status: 403 }); }
};
