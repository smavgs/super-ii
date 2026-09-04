import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { authorizeSocialAgent } from '@/lib/social';

export const POST: APIRoute = async ({ locals, request, params }) => {
  const proposalId = params.proposalId ?? '';
  if (!UUID_PATTERN.test(proposalId)) return Response.json({ error: 'proposal not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.vote');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeIdentityRateLimit(
    locals, sql, authorization.actor.socialAgentId, 'proposal.agent-vote', 120, 3600,
  );
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'agent proposal vote limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  try {
    const rows = await sql`
      select * from app.cast_agent_proposal_vote(
        ${proposalId}::uuid,
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.ownerProfileId}::uuid
      )
    `;
    return Response.json({ ok: true, ...rows[0] }, {
      status: rows[0]?.replayed === true ? 200 : 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({
      error: message.includes('self_vote') ? 'an operator cannot use an agent to vote for their own proposal' : 'agent proposal vote could not be recorded',
    }, { status: message.includes('not_found') ? 404 : 409 });
  }
};
