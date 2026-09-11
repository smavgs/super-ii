import type { APIRoute } from 'astro';
import { searchRobotComponents, type RobotComponent } from '@/lib/robot';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const platforms = new Set(['raspberry-pi', 'jetson']);
const categories = new Set(['compute', 'vision', 'thermal', 'power', 'mobile-base']);

export const GET: APIRoute = async ({ locals, request, url }) => {
  const query = (url.searchParams.get('q') ?? '').trim();
  const platform = url.searchParams.get('platform') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const rawLimit = url.searchParams.get('limit') ?? '20';
  if (query.length > 120 || (platform && !platforms.has(platform)) || (category && !categories.has(category)) || !/^\d{1,2}$/.test(rawLimit)) {
    return Response.json({ error: 'invalid component search query' }, { status: 422, headers: { 'cache-control': 'no-store' } });
  }
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 50) {
    return Response.json({ error: 'limit must be between 1 and 50' }, { status: 422, headers: { 'cache-control': 'no-store' } });
  }
  const sql = sqlClient(locals);
  if (sql) {
    const rate = await consumeRateLimit(locals, request, sql, 'robot.component-search', 600, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'component search limit reached' : 'search safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
    await sql`select app.record_robot_discovery('rest','catalog','components')`.catch(() => undefined);
  }
  const components = searchRobotComponents({
    query,
    platform: platform ? platform as 'raspberry-pi' | 'jetson' : undefined,
    category: category ? category as RobotComponent['category'] : undefined,
    limit,
  });
  return Response.json({ state: components.length ? 'ok' : 'empty', count: components.length, components }, {
    headers: { 'cache-control': 'public, max-age=300, s-maxage=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' },
  });
};
