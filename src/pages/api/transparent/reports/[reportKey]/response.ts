import type { APIRoute } from 'astro';
import { z } from 'zod';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { privateTransparencyHeaders } from '@/lib/transparent-http';
import { addTransparencyCreatorResponse } from '@/lib/transparent-store';

const inputSchema = z.object({
  response_type: z.enum(['response', 'correction']),
  body: z.string().trim().min(10).max(4_000),
  evidence_urls: z.array(z.url().refine((value) => value.startsWith('https://'))).max(10).default([]),
}).strict();

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateTransparencyHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateTransparencyHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateTransparencyHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'transparent.response', 20, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'response limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateTransparencyHeaders });
  const body = await readBoundedJsonObject(request, 16_384);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateTransparencyHeaders });
  const input = inputSchema.safeParse(body.value);
  if (!input.success) return Response.json({ error: 'invalid creator response' }, { status: 422, headers: privateTransparencyHeaders });
  try {
    const added = await addTransparencyCreatorResponse(sql, profile.profileId, params.reportKey ?? '', { responseType: input.data.response_type, body: input.data.body, evidenceUrls: input.data.evidence_urls });
    return added ? Response.json({ ok: true }, { status: 201, headers: privateTransparencyHeaders }) : Response.json({ error: 'A verified project claim is required before publishing a creator response.' }, { status: 403, headers: privateTransparencyHeaders });
  } catch {
    return Response.json({ error: 'creator response could not be recorded' }, { status: 503, headers: privateTransparencyHeaders });
  }
};
