import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { checkHuggingFaceTransparency } from '@/lib/transparent';
import { privateTransparencyHeaders, transparencyErrorResponse } from '@/lib/transparent-http';
import { getTransparencyReport, persistTransparencyReport } from '@/lib/transparent-store';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Transparency report database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.check', 20, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Daily Transparency Check limit reached for this network.' : 'Transparency safety service unavailable.' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  try {
    const previous = await getTransparencyReport(sql, params.reportKey ?? '');
    if (!previous) return Response.json({ error: 'report not found' }, { status: 404, headers: privateTransparencyHeaders });
    const checked = await checkHuggingFaceTransparency({ source: previous.repository.canonical_url, revision: 'main' });
    const stored = await persistTransparencyReport(sql, checked);
    await sql`select app.record_transparency_discovery('web','check',${stored.report.repository.id})`.catch(() => undefined);
    return Response.json({ ok: true, changed: stored.report.report_key !== previous.report_key, report_key: stored.report.report_key, report_url: `/transparent/${stored.report.report_key}` }, { headers: privateTransparencyHeaders });
  } catch (error) {
    return transparencyErrorResponse(error);
  }
};
