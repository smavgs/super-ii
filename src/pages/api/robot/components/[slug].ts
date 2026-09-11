import type { APIRoute } from 'astro';
import { componentCompatibilityClaims, robotComponent } from '@/lib/robot';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const slug = params.slug ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return Response.json({ error: 'component not found' }, { status: 404 });
  }
  const component = robotComponent(slug);
  if (!component) return Response.json({ error: 'component not found' }, { status: 404 });
  const compatibility = componentCompatibilityClaims(slug);
  const sql = sqlClient(locals);
  if (sql) {
    const rate = await consumeRateLimit(locals, request, sql, 'robot.component-detail', 600, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'component retrieval limit reached' : 'retrieval safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
    await sql`select app.record_robot_discovery('rest','component',${slug})`.catch(() => undefined);
  }
  return Response.json({ component, compatibility }, {
    headers: { 'cache-control': 'public, max-age=300, s-maxage=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' },
  });
};
