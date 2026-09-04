import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { isPlatformAdmin, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

const statuses = new Set(['accepted', 'building', 'shipped', 'removed']);

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const proposalId = params.proposalId ?? '';
  if (!UUID_PATTERN.test(proposalId)) return Response.json({ error: 'proposal not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  if (!isPlatformAdmin(locals, profile.clerkUserId)) return Response.json({ error: 'admin access required' }, { status: 403 });
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const status = textValue(parsed.value.status, 20);
  const reason = textValue(parsed.value.reason, 1000);
  if (!statuses.has(status)) return Response.json({ error: 'invalid status transition' }, { status: 422 });
  try {
    const rows = await sql`
      select * from app.set_proposal_status(
        ${proposalId}::uuid, ${profile.profileId}::uuid, ${status}, ${reason}
      )
    `;
    return Response.json({ ok: true, proposal: rows[0] });
  } catch {
    return Response.json({ error: 'proposal status transition was refused' }, { status: 409 });
  }
};
