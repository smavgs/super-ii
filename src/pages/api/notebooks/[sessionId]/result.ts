import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  if (!profile) return Response.json({ error: 'sign in to download this result' }, { status: 401 });
  const sessionId = params.sessionId ?? '';
  let allowed = false;
  try {
    const rows = await sql`
      select exists (
        select 1 from app.notebook_execution_sessions
        where id = ${sessionId}::uuid
          and profile_id = ${profile.profileId}::uuid
          and status = 'succeeded'
          and expires_at > now()
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return Response.json({ error: 'executed notebook result not found' }, { status: 404 });
  const upstream = await runtimeFetch(
    locals,
    `/v1/notebooks/${sessionId}/result?profile_id=${encodeURIComponent(profile.profileId)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!upstream) return Response.json({ error: 'notebook result runtime unavailable' }, { status: 503 });
  if (!upstream.ok) return Response.json({ error: 'executed notebook result unavailable' }, { status: upstream.status });
  return proxiedFileResponse(upstream, false);
};
