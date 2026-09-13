import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { publicTransparencyHeaders, transparencyOptions } from '@/lib/transparent-http';
import { getTransparencyReport } from '@/lib/transparent-store';

export const OPTIONS: APIRoute = async () => transparencyOptions();

export const GET: APIRoute = async ({ locals, params, request }) => {
  const reportKey = params.reportKey ?? '';
  if (!/^[a-f0-9]{64}$/.test(reportKey)) return Response.json({ error: 'report not found' }, { status: 404, headers: publicTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Transparency report database unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.read', 600, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Transparency report read limit reached' : 'Transparency safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: publicTransparencyHeaders });
  try {
    const report = await getTransparencyReport(sql, reportKey);
    if (!report) return Response.json({ error: 'report not found' }, { status: 404, headers: publicTransparencyHeaders });
    await sql`select app.record_transparency_discovery('rest','read',${report.repository.id})`.catch(() => undefined);
    return Response.json({ report }, { headers: publicTransparencyHeaders });
  } catch {
    return Response.json({ error: 'Transparency report unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  }
};
