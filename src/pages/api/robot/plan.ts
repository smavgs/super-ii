import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { makeRobotInputSchema, makeRobotPlan } from '@/lib/robot';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: corsHeaders });

export const POST: APIRoute = async ({ locals, request }) => {
  const parsedBody = await readBoundedJsonObject(request, 8_192);
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status });
  const parsed = makeRobotInputSchema.safeParse(parsedBody.value);
  if (!parsed.success) {
    return Response.json({ error: 'invalid Make Robot request', issues: parsed.error.issues }, { status: 422, headers: { 'cache-control': 'no-store' } });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'planning safety service unavailable' }, {
    status: 503, headers: { ...corsHeaders, 'retry-after': '30' },
  });
    const rate = await consumeRateLimit(locals, request, sql, 'robot.plan', 120, 3600);
    if (rate !== 'allowed') {
      return Response.json({ error: rate === 'limited' ? 'Make Robot planning limit reached' : 'planning safety service unavailable' }, {
        status: rate === 'limited' ? 429 : 503,
        headers: { ...corsHeaders, 'retry-after': rate === 'limited' ? '3600' : '30' },
      });
    }
    await sql`select app.record_robot_discovery('rest','planner','make-robot')`.catch(() => undefined);
  return Response.json({ plan: makeRobotPlan(parsed.data) }, {
    headers: corsHeaders,
  });
};
