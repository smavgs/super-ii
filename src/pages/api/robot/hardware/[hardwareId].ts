import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const id = params.hardwareId ?? ''; if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return Response.json({ error: 'hardware item not found' }, { status: 404 });
  const sql = sqlClient(locals); if (!sql) return Response.json({ error: 'hardware inventory unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql); if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      update app.robot_hardware hardware set archived_at = now(), updated_at = now()
      where hardware.id = ${id}::uuid and hardware.archived_at is null and (
        hardware.owner_profile_id = ${profile.profileId}::uuid or exists (
          select 1 from app.organization_members member where member.organization_id = hardware.owner_organization_id
            and member.profile_id = ${profile.profileId}::uuid and member.role in ('owner','admin','maintainer')
        )
      ) returning id
    `;
    return rows.length ? Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }) : Response.json({ error: 'hardware item not found' }, { status: 404 });
  } catch { return Response.json({ error: 'hardware item could not be archived' }, { status: 503 }); }
};
