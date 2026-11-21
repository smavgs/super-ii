import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { analyticsChoice, parseExperience } from '@/lib/experience';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = { 'cache-control': 'private, no-store' };
export const POST: APIRoute = async ({ request, locals }) => {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers });
  // Refuse before body parsing or PostgreSQL when consent is absent/withdrawn.
  if (analyticsChoice(request.headers.get('cookie') ?? '') !== 'allow') return new Response(null, { status: 204, headers });
  const parsed = await readBoundedJsonObject(request, 512);
  if (!parsed.ok) return new Response(null, { status: parsed.status, headers });
  const input = parseExperience(parsed.value);
  if (!input) return new Response(null, { status: 422, headers });
  const sql = sqlClient(locals);
  if (!sql) return new Response(null, { status: 503, headers });
  const rate = await consumeRateLimit(locals, request, sql, 'experience.event', 180, 3600);
  if (rate !== 'allowed') return new Response(null, { status: rate === 'limited' ? 429 : 503, headers });
  try {
    await sql`select app.record_experience_event(${input.event}, ${input.surface}, ${input.locale})`;
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
};
