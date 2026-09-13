import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { publicTransparencyHeaders, transparencyOptions } from '@/lib/transparent-http';
import { searchTransparencyReports } from '@/lib/transparent-store';

export const OPTIONS: APIRoute = async () => transparencyOptions();

export const GET: APIRoute = async ({ locals, request, url }) => {
  const query = (url.searchParams.get('q') ?? '').trim();
  const kind = url.searchParams.get('kind') ?? '';
  const rawLimit = url.searchParams.get('limit') ?? '20';
  const rawOffset = url.searchParams.get('offset') ?? '0';
  if (query.length > 120 || (kind && !['model', 'dataset', 'space'].includes(kind)) || !/^\d{1,2}$/.test(rawLimit) || !/^\d{1,5}$/.test(rawOffset)) {
    return Response.json({ error: 'invalid transparency report search' }, { status: 422, headers: publicTransparencyHeaders });
  }
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (limit < 1 || limit > 50 || offset > 10_000) return Response.json({ error: 'search bounds exceeded' }, { status: 422, headers: publicTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Transparency report database unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.search', 300, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Transparency search limit reached' : 'Transparency safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: publicTransparencyHeaders });
  try {
    const reports = await searchTransparencyReports(sql, { query, kind, limit, offset });
    await sql`select app.record_transparency_discovery('rest','search',${query || kind || 'recent'})`.catch(() => undefined);
    return Response.json({ state: reports.length ? 'ok' : 'empty', count: reports.length, reports }, { headers: publicTransparencyHeaders });
  } catch {
    return Response.json({ error: 'Transparency report search unavailable' }, { status: 503, headers: publicTransparencyHeaders });
  }
};
