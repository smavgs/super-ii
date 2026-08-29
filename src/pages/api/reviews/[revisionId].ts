import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { isPlatformAdmin, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile || !isPlatformAdmin(locals, profile.clerkUserId)) {
    return Response.json({ error: 'reviewer access required' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const decision = body.decision;
  const notes = textValue(body.notes, 20_000);
  if (decision !== 'approved' && decision !== 'rejected') {
    return Response.json({ error: 'decision must be approved or rejected' }, { status: 400 });
  }
  const revisionId = params.revisionId ?? '';
  try {
    const targets = await sql`
      select rr.repository_id, r.title,
             coalesce(array_remove(array_agg(distinct owner.id), null), '{}') as recipients
      from app.repository_revisions rr
      join app.repositories r on r.id = rr.repository_id
      left join app.profiles owner on owner.id = r.owner_profile_id
        or exists (
          select 1 from app.organization_members member
          where member.organization_id = r.owner_organization_id
            and member.profile_id = owner.id and member.role in ('owner', 'admin')
        )
      where rr.id = ${revisionId}::uuid and rr.status = 'review'
      group by rr.repository_id, r.title
    `;
    if (!targets.length) return Response.json({ error: 'reviewable revision not found' }, { status: 404 });
    const target = targets[0];
    await sql`
      insert into app.repository_reviews (repository_id, revision_id, reviewer_id, decision, notes)
      values (${String(target.repository_id)}::uuid, ${revisionId}::uuid, ${profile.clerkUserId}, ${decision}::repository_review_decision, ${notes})
      on conflict (revision_id, reviewer_id) do update set
        decision = excluded.decision, notes = excluded.notes, updated_at = now()
    `;
    if (decision === 'approved') {
      await sql`select app.publish_repository_revision(${revisionId}::uuid, ${profile.clerkUserId})`;
    } else {
      await sql`update app.repository_revisions set status = 'rejected', updated_at = now() where id = ${revisionId}::uuid and status = 'review'`;
    }
    const recipients = Array.isArray(target.recipients) ? target.recipients : [];
    for (const recipient of recipients) {
      await sql`
        insert into app.notifications (profile_id, event_type, title, body, href, metadata)
        values (${String(recipient)}::uuid, ${`repository.review_${decision}`}, ${decision === 'approved' ? 'Repository published ✅' : 'Repository changes requested'}, ${notes || (decision === 'approved' ? 'Human review passed and the repository is public.' : 'Open the workspace for the reviewer decision.')}, ${`/repositories/${String(target.repository_id)}/edit`}, ${JSON.stringify({ revision_id: revisionId, decision })}::jsonb)
      `;
    }
    return Response.json({ ok: true, decision });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'review could not be completed';
    return Response.json({ error: message.slice(0, 500) }, { status: 409 });
  }
};
