import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const jobId = params.jobId ?? '';
  if (!UUID_PATTERN.test(jobId)) return Response.json({ error: 'job not found' }, { status: 404 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const parsed = await readBoundedJsonObject(request, 8192);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const decision = textValue(payload.decision, 20);
  const notes = textValue(payload.notes, 4000);
  if (!['accepted', 'rejected'].includes(decision)) {
    return Response.json({ error: 'decision must be accepted or rejected' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select app.review_agent_contribution(
        ${profile.profileId}::uuid, ${jobId}::uuid, ${decision}, ${notes}
      ) as outcome
    `;
    return Response.json({ ok: true, ...(rows[0]?.outcome as Record<string, unknown>) });
  } catch {
    return Response.json({ error: 'job is not reviewable or owner/admin access is required' }, { status: 409 });
  }
};
