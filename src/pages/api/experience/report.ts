import type { APIRoute } from 'astro';
import { isPlatformAdmin } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const headers = { 'cache-control': 'private, no-store' };
export const GET: APIRoute = async ({ locals }) => {
  const auth = typeof locals.auth === 'function' ? locals.auth() : null;
  const userId = auth && 'userId' in auth ? auth.userId : null;
  if (!userId || !isPlatformAdmin(locals, userId)) return Response.json({ error: 'not authorized' }, { status: 403, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'unavailable' }, { status: 503, headers });
  try {
    const rows = await sql`select * from app.experience_report()`;
    return Response.json({ note: 'Opt-in action counts, not unique visitors or verified signups/downloads. No visitor identifiers are stored in these counters.', days: 90, rows }, { headers });
  } catch { return Response.json({ error: 'unavailable' }, { status: 503, headers }); }
};
