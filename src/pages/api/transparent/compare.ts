import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { publicTransparencyHeaders, transparencyErrorResponse, transparencyOptions } from '@/lib/transparent-http';
import { compareStoredTransparencyReports } from '@/lib/transparent-store';

export const OPTIONS: APIRoute = async () => transparencyOptions();

export const GET: APIRoute = async ({ locals, request, url }) => {
  const left = url.searchParams.get('left') ?? '';
  const right = url.searchParams.get('right') ?? '';
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right) || left === right) {
    return Response.json({ error: 'two different report keys are required' }, { status: 422, headers: publicTransparencyHeaders });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Transparency report database unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.compare', 300, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Transparency comparison limit reached' : 'Transparency safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: publicTransparencyHeaders });
  try {
    const comparison = await compareStoredTransparencyReports(sql, left, right);
    if (!comparison) return Response.json({ error: 'report not found' }, { status: 404, headers: publicTransparencyHeaders });
    await sql`select app.record_transparency_discovery('rest','compare',${comparison.repository})`.catch(() => undefined);
    return Response.json({ comparison }, { headers: publicTransparencyHeaders });
  } catch (error) {
    return transparencyErrorResponse(error, publicTransparencyHeaders);
  }
};
