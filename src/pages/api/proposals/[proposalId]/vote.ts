import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit, consumeRateLimit, requestNetworkHash } from '@/lib/rate-limit';

export const POST: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const proposalId = params.proposalId ?? '';
  if (!UUID_PATTERN.test(proposalId)) return Response.json({ error: 'proposal not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const [networkRate, identityRate, networkHash] = await Promise.all([
    consumeRateLimit(locals, request, sql, 'proposal.vote', 240, 3600),
    consumeIdentityRateLimit(locals, sql, profile.profileId, 'proposal.vote.identity', 120, 3600),
    requestNetworkHash(locals, request, 'proposal-human-vote'),
  ]);
  if (networkRate !== 'allowed' || identityRate !== 'allowed' || !networkHash) {
    const limited = networkRate === 'limited' || identityRate === 'limited';
    return Response.json({ error: limited ? 'proposal vote limit reached' : 'safety service unavailable' }, {
      status: limited ? 429 : 503,
    });
  }
  try {
    const rows = await sql`
      select * from app.cast_human_proposal_vote(
        ${proposalId}::uuid, ${profile.profileId}::uuid, ${networkHash}
      )
    `;
    return Response.json({ ok: true, ...rows[0] }, {
      status: rows[0]?.replayed === true ? 200 : 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({
      error: message.includes('self_vote') ? 'you cannot vote for your own proposal' : 'proposal vote could not be recorded',
    }, { status: message.includes('not_found') ? 404 : 409 });
  }
};
