import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getPublicRobot, robotJson } from '@/lib/robot-store';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const owner = params.owner ?? ''; const slug = params.slug ?? '';
  if (!/^[a-z0-9-]{1,80}$/i.test(owner) || !/^[a-z0-9-]{1,96}$/.test(slug)) return Response.json({ error: 'public Robot not found' }, { status: 404 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'Robot database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'robot.public-get', 600, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'public Robot read limit reached' : 'Robot safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  try {
    const robot = await getPublicRobot(sql, owner, slug);
    if (!robot) return Response.json({ error: 'public Robot not found' }, { status: 404 });
    await sql`select app.record_robot_discovery('rest','robot',${`${owner}/${slug}`})`.catch(() => undefined);
    return Response.json({ robot: robotJson(robot, new URL(request.url).origin) }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=120', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  } catch { return Response.json({ error: 'Robot database unavailable' }, { status: 503 }); }
};
