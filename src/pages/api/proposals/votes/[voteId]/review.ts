import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { isPlatformAdmin, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const riskStates = new Set(['valid', 'flagged', 'removed']);

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const voteId = params.voteId ?? '';
  if (!UUID_PATTERN.test(voteId)) return Response.json({ error: 'vote not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  if (!isPlatformAdmin(locals, profile.clerkUserId)) return Response.json({ error: 'admin access required' }, { status: 403 });
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const riskState = textValue(parsed.value.risk_state, 20);
  const reason = textValue(parsed.value.reason, 240);
  if (!riskStates.has(riskState)) return Response.json({ error: 'invalid vote review state' }, { status: 422 });
  try {
    const rows = await sql`
      select * from app.review_proposal_vote(
        ${voteId}::uuid, ${profile.profileId}::uuid, ${riskState}, ${reason}
      )
    `;
    return Response.json({ ok: true, vote: rows[0] });
  } catch {
    return Response.json({ error: 'vote review could not be applied' }, { status: 409 });
  }
};
