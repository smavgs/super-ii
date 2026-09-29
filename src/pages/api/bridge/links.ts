import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { bridgeIdentityToken, detectBridgeSource, inspectHuggingFaceRepository } from '@/lib/bridge';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const privateHeaders = { 'cache-control': 'private, no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateHeaders });
  const items = await sql`
    select item.id, item.kind, item.provider_repo_id, item.source_url,
           item.source_revision, item.title, item.summary, item.license,
           item.provider_downloads, item.provider_likes, item.updated_at,
           organization.handle as organization_handle
    from app.external_catalog_items item
    left join app.organizations organization on organization.id = item.owner_organization_id
    where item.status = 'active' and (
      item.owner_profile_id = ${profile.profileId}::uuid
      or exists (
        select 1 from app.organization_members member
        where member.organization_id = item.owner_organization_id
          and member.profile_id = ${profile.profileId}::uuid
          and member.role in ('owner','admin','maintainer')
      )
    ) order by item.updated_at desc limit 100
  `;
  return Response.json({ items }, { headers: privateHeaders });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'bridge.link', 30, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'daily linked work limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateHeaders });
  const parsed = await readBoundedJsonObject(request, 32_768);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  const identityId = typeof parsed.value.identity_id === 'string' ? parsed.value.identity_id : '';
  const organizationId = typeof parsed.value.organization_id === 'string' && parsed.value.organization_id
    ? parsed.value.organization_id
    : null;
  const selected = Array.isArray(parsed.value.repositories) ? parsed.value.repositories.slice(0, 30) : [];
  if (!uuidPattern.test(identityId) || (organizationId && !uuidPattern.test(organizationId)) || !selected.length) {
    return Response.json({ error: 'Connect a verified account and select public work' }, { status: 422, headers: privateHeaders });
  }
  try {
    const credentials = await bridgeIdentityToken(locals, sql, profile.profileId, identityId);
    if (!credentials.identity) throw new Error('verified_identity_required');
    const linked: Array<{ id: string; provider_repo_id: string }> = [];
    for (const raw of selected) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_repository_selection');
      const selection = raw as Record<string, unknown>;
      const source = detectBridgeSource(selection.source_url);
      if (!source || source.kind !== 'repository') throw new Error('invalid_repository_selection');
      const current = await inspectHuggingFaceRepository(source, credentials.token, credentials.identity.scopes);
      if (current.source_visibility !== 'public') throw new Error('only_public_work_can_be_linked');
      if (typeof selection.source_revision === 'string' && selection.source_revision !== current.source_revision) {
        throw new Error('source_revision_changed');
      }
      const rows = await sql`
        select app.link_external_catalog_item(
          ${identityId}::uuid, ${organizationId}::uuid, ${current.kind}::repository_kind,
          ${current.provider_repo_id}, ${current.source_revision}, ${current.source_url},
          ${current.title}, ${current.summary}, ${current.license}, ${current.file_count},
          ${current.total_size_bytes}, ${JSON.stringify(current.source_metadata)}::jsonb
        ) as id
      `;
      linked.push({ id: String(rows[0]?.id), provider_repo_id: current.provider_repo_id });
    }
    return Response.json({ ok: true, linked }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const raw = error instanceof Error ? error.message : '';
    const code = /^[a-z0-9_]{1,120}$/u.test(raw) ? raw : 'linked_work_failed';
    const status = code === 'provider_rate_limited' ? 429 : code.includes('verified') || code.includes('authorization') ? 403 : 422;
    return Response.json({ error: code.replaceAll('_', ' ') }, { status, headers: privateHeaders });
  }
};

export const DELETE: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503, headers: privateHeaders });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers: privateHeaders });
  const rate = await consumeRateLimit(locals, request, sql, 'bridge.unlink', 60, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'daily linked work removal limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers: privateHeaders });
  const parsed = await readBoundedJsonObject(request, 2_048);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  const itemId = typeof parsed.value.item_id === 'string' ? parsed.value.item_id : '';
  if (!uuidPattern.test(itemId)) return Response.json({ error: 'invalid linked work item' }, { status: 422, headers: privateHeaders });
  const rows = await sql`select app.unlink_external_catalog_item(${itemId}::uuid) as removed`;
  if (rows[0]?.removed !== true) return Response.json({ error: 'linked work item not found' }, { status: 404, headers: privateHeaders });
  return Response.json({ ok: true }, { headers: privateHeaders });
};
