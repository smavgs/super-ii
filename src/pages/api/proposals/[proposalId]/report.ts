import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const reasons = new Set(['spam', 'abuse', 'manipulation', 'duplicate', 'unsafe', 'other']);

export const POST: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const proposalId = params.proposalId ?? '';
  if (!UUID_PATTERN.test(proposalId)) return Response.json({ error: 'proposal not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'proposal.report', 20, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'report limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const reason = textValue(parsed.value.reason, 32);
  const detail = textValue(parsed.value.detail, 2000);
  if (!reasons.has(reason)) return Response.json({ error: 'valid report reason required' }, { status: 422 });
  try {
    const rows = await sql`
      select * from app.report_proposal(
        ${proposalId}::uuid, ${profile.profileId}::uuid, ${reason}, ${detail}
      )
    `;
    return Response.json({ ok: true, report_id: rows[0]?.id }, { status: 201 });
  } catch {
    return Response.json({ error: 'proposal report could not be recorded' }, { status: 409 });
  }
};
