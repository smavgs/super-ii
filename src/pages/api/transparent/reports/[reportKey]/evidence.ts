import type { APIRoute } from 'astro';
import { z } from 'zod';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { privateTransparencyHeaders } from '@/lib/transparent-http';
import { submitTransparencyEvidence } from '@/lib/transparent-store';

const inputSchema = z.object({
  criterion_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  note: z.string().trim().min(10).max(2_000),
  source_url: z.url().refine((value) => value.startsWith('https://')),
}).strict();

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.evidence', 30, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'evidence submission limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  const body = await readBoundedJsonObject(request, 8_192);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateTransparencyHeaders });
  const input = inputSchema.safeParse(body.value);
  if (!input.success) return Response.json({ error: 'invalid evidence submission' }, { status: 422, headers: privateTransparencyHeaders });
  try {
    const submitted = await submitTransparencyEvidence(sql, profile.profileId, params.reportKey ?? '', { criterionId: input.data.criterion_id, note: input.data.note, sourceUrl: input.data.source_url });
    return submitted ? Response.json({ ok: true, state: 'pending_review' }, { status: 201, headers: privateTransparencyHeaders }) : Response.json({ error: 'report not found' }, { status: 404, headers: privateTransparencyHeaders });
  } catch {
    return Response.json({ error: 'evidence could not be submitted' }, { status: 503, headers: privateTransparencyHeaders });
  }
};
