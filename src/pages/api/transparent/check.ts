import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { checkHuggingFaceTransparency, transparencyCheckInputSchema } from '@/lib/transparent';
import { persistTransparencyReport } from '@/lib/transparent-store';
import { publicTransparencyHeaders, transparencyErrorResponse, transparencyOptions } from '@/lib/transparent-http';

export const OPTIONS: APIRoute = async () => transparencyOptions();

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Transparency report database unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.check', 20, 86_400);
  if (rate !== 'allowed') return Response.json(
    { error: rate === 'limited' ? 'Daily Transparency Check limit reached for this network.' : 'Transparency safety service unavailable.' },
    { status: rate === 'limited' ? 429 : 503, headers: { ...publicTransparencyHeaders, ...(rate === 'limited' ? { 'retry-after': '86400' } : {}) } },
  );
  const body = await readBoundedJsonObject(request, 4_096);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: publicTransparencyHeaders });
  const parsed = transparencyCheckInputSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: 'Provide one Hugging Face repository link and an optional revision.' }, { status: 422, headers: publicTransparencyHeaders });
  try {
    const checked = await checkHuggingFaceTransparency(parsed.data);
    const stored = await persistTransparencyReport(sql, checked);
    await sql`select app.record_transparency_discovery('rest','check',${stored.report.repository.id})`.catch(() => undefined);
    return Response.json({
      ok: true,
      created: stored.created,
      report_key: stored.report.report_key,
      report_url: new URL(`/transparent/${stored.report.report_key}`, request.url).toString(),
      report: stored.report,
    }, { status: stored.created ? 201 : 200, headers: { ...publicTransparencyHeaders, location: `/transparent/${stored.report.report_key}` } });
  } catch (error) {
    return transparencyErrorResponse(error, publicTransparencyHeaders);
  }
};
