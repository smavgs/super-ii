import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const handlePattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const idPattern = /^[a-zA-Z0-9._:-]{1,255}$/;
const types = new Set(['company', 'university', 'classroom', 'non-profit', 'government', 'community']);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'bridge.organization-claim', 10, 86400);
  if (rateLimit !== 'allowed') {
    return Response.json({ error: rateLimit === 'limited' ? 'organization claim limit reached' : 'safety service unavailable' }, { status: rateLimit === 'limited' ? 429 : 503 });
  }
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const identityId = typeof payload.identity_id === 'string' ? payload.identity_id : '';
  const providerOrganizationId = typeof payload.provider_organization_id === 'string' ? payload.provider_organization_id : '';
  const handle = typeof payload.handle === 'string' ? payload.handle.trim().toLowerCase() : '';
  const organizationType = typeof payload.organization_type === 'string' ? payload.organization_type : '';
  if (!/^[a-f0-9-]{36}$/i.test(identityId) || !idPattern.test(providerOrganizationId) || !handlePattern.test(handle) || !types.has(organizationType)) {
    return Response.json({ error: 'verified organization, username, and type are required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select app.claim_bridge_organization(
        ${profile.profileId}::uuid,
        ${identityId}::uuid,
        ${providerOrganizationId},
        ${handle},
        ${organizationType}
      ) as organization_id
    `;
    if (!rows[0]?.organization_id) throw new Error('claim failed');
    return Response.json({ ok: true, href: `/organizations/${handle}` }, { status: 201 });
  } catch {
    return Response.json({ error: 'Only a verified organization admin can claim an available namespace' }, { status: 409 });
  }
};
