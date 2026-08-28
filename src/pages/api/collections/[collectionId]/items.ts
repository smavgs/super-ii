import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'collection.item', 200, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json({ error: rateLimit === 'limited' ? 'collection item rate limit reached' : 'safety service unavailable' }, { status: rateLimit === 'limited' ? 429 : 503 });
  }
  let payload: { repository_id?: unknown; note?: unknown; position?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof payload.repository_id !== 'string') {
    return Response.json({ error: 'repository_id is required' }, { status: 422 });
  }
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 2000) : '';
  const position = Number.isSafeInteger(payload.position) && Number(payload.position) >= 0
    ? Number(payload.position)
    : 0;
  try {
    const rows = await sql`
      insert into app.collection_items (collection_id, repository_id, position, note)
      select c.id, r.id, ${position}, ${note}
      from app.collections c
      join app.repositories r on r.id = ${payload.repository_id}::uuid
      where c.id = ${params.collectionId ?? ''}::uuid
        and c.owner_profile_id = ${profile.profileId}::uuid
        and r.visibility = 'public'
        and r.status = 'published'
      on conflict (collection_id, repository_id) do update
      set position = excluded.position, note = excluded.note
      returning collection_id
    `;
    if (!rows.length) return Response.json({ error: 'collection or repository not found' }, { status: 404 });
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: 'collection item could not be saved' }, { status: 422 });
  }
};
