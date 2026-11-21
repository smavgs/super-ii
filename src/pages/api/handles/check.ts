import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { requestedHandle } from '@/lib/welcome';

const headers = { 'cache-control': 'private, no-store' };
export const POST: APIRoute = async ({ request, locals }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers });
  const body = await readBoundedJsonObject(request, 256);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers });
  const handle = requestedHandle(body.value.handle);
  if (Object.keys(body.value).length !== 1 || !handle) return Response.json({ available: false }, { headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'unavailable' }, { status: 503, headers });
  const rate = await consumeRateLimit(locals, request, sql, 'handle.check', 60, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate }, { status: rate === 'limited' ? 429 : 503, headers: { ...headers, 'retry-after': '60' } });
  try {
    const rows = await sql`select app.profile_handle_available(${handle}) as available`;
    return Response.json({ available: rows[0]?.available === true }, { headers });
  } catch { return Response.json({ error: 'unavailable' }, { status: 503, headers }); }
};
