import type { APIRoute } from 'astro';
import { z } from 'zod';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { robotComponent } from '@/lib/robot';

const schema = z.object({
  organization_id: z.uuid(),
  proposed_changes: z.record(z.string().min(1).max(80), z.unknown()).refine((value) => JSON.stringify(value).length <= 60_000),
  source_urls: z.array(z.url().refine((value) => value.startsWith('https://'))).min(1).max(20),
}).strict();

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const slug = params.slug ?? ''; if (!robotComponent(slug)) return Response.json({ error: 'component not found' }, { status: 404 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'manufacturer maintenance unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const body = await readBoundedJsonObject(request, 65_536); if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value); if (!parsed.success) return Response.json({ error: 'invalid maintenance proposal', issues: parsed.error.issues }, { status: 422 });
  try {
    const access = await sql`
      select app.organization_robot_plan_rank(${profile.profileId}::uuid, ${parsed.data.organization_id}::uuid) as rank,
        exists (select 1 from app.organization_members where organization_id = ${parsed.data.organization_id}::uuid and profile_id = ${profile.profileId}::uuid and role in ('owner','admin')) as administrator
    `;
    if (Number(access[0]?.rank ?? 0) < 2 || access[0]?.administrator !== true) return Response.json({ error: 'manufacturer maintenance requires an eligible commercial organization and owner/admin review authority' }, { status: 403 });
    const rows = await sql`
      insert into app.robot_component_claims (organization_id, component_slug, proposed_changes, source_urls, submitted_by_profile_id)
      values (${parsed.data.organization_id}::uuid, ${slug}, ${JSON.stringify(parsed.data.proposed_changes)}::jsonb, ${JSON.stringify(parsed.data.source_urls)}::jsonb, ${profile.profileId}::uuid)
      returning id, status
    `;
    return Response.json({ ok: true, claim_id: rows[0]?.id, status: rows[0]?.status, applied: false, review_required: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'a pending maintenance proposal already exists or the proposal could not be recorded' }, { status: 409 }); }
};
