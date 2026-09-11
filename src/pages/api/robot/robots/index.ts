import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { makeRobotPlan, saveRobotInputSchema } from '@/lib/robot';
import { listOwnedRobots, listPublicRobots, robotJson } from '@/lib/robot-store';

export const GET: APIRoute = async ({ locals, request, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Robot database unavailable' }, { status: 503 });
  const mine = url.searchParams.get('mine') === '1';
  const unexpected = [...url.searchParams.keys()].some((key) => !['mine','q','limit','offset'].includes(key));
  const query = (url.searchParams.get('q') ?? '').trim();
  const rawLimit = url.searchParams.get('limit') ?? '20';
  const rawOffset = url.searchParams.get('offset') ?? '0';
  if (unexpected || query.length > 120 || !/^\d{1,2}$/.test(rawLimit) || !/^\d{1,5}$/.test(rawOffset) || Number(rawLimit) < 1 || Number(rawLimit) > 50 || Number(rawOffset) > 10_000) {
    return Response.json({ error: 'invalid Robot search query' }, { status: 422 });
  }
  try {
    if (mine) {
      const profile = await ensureAuthenticatedProfile(locals, sql);
      if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
      const robots = await listOwnedRobots(sql, profile.profileId);
      return Response.json({ robots }, { headers: { 'cache-control': 'private, no-store' } });
    }
    const rate = await consumeRateLimit(locals, request, sql, 'robot.public-search', 300, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'public Robot search limit reached' : 'search safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
    const robots = await listPublicRobots(sql, { query, limit: Number(rawLimit), offset: Number(rawOffset) });
    await sql`select app.record_robot_discovery('rest','catalog','public-robots')`.catch(() => undefined);
    const origin = new URL(request.url).origin;
    return Response.json({ state: robots.length ? 'ok' : 'empty', count: robots.length, robots: robots.map((row) => robotJson(row, origin)) }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=120', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  } catch { return Response.json({ error: 'Robot database unavailable' }, { status: 503 }); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Robot database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'robot.create', 30, 86400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Robot creation limit reached' : 'Robot safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  const body = await readBoundedJsonObject(request, 32_768);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = saveRobotInputSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: 'invalid Robot', issues: parsed.error.issues }, { status: 422 });
  const input = parsed.data;
  const plan = makeRobotPlan(input.planner_input);
  try {
    const rows = await sql`
      select * from app.create_robot_with_version(
        ${profile.profileId}::uuid, ${input.organization_id}::uuid, ${input.slug}, ${input.title},
        ${input.summary}, ${input.audience}, ${input.visibility}, ${JSON.stringify(input.planner_input)}::jsonb,
        ${JSON.stringify(plan)}::jsonb, ${plan.catalog_revision}, ${input.change_summary}, null
      )
    `;
    const created = rows[0];
    return Response.json({ ok: true, robot_id: created?.robot_id, version_id: created?.version_id, version_number: created?.version_number, href: `/robot/${encodeURIComponent(String(created?.owner_handle ?? ''))}/${encodeURIComponent(input.slug)}` }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const detail = String(error);
    if (detail.includes('requires_pro') || detail.includes('requires_team') || detail.includes('permission')) return Response.json({ error: input.visibility === 'private' ? 'Private Robots require Pro; organization Robots require Team.' : 'This owner requires a current Team plan and matching role.' }, { status: 403 });
    return Response.json({ error: 'Robot URL is unavailable or the selected owner is invalid' }, { status: 409 });
  }
};
