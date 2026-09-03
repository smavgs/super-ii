import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { FRAMEWORK_PATTERN } from '@/lib/agent-management';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import {
  authorizeSocialAgent,
  getSocialProfile,
  hashSocialRequest,
  socialIdempotencyKey,
  socialTags,
} from '@/lib/social';

export const GET: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.profile.read');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const profile = await getSocialProfile(sql, authorization.actor.handle);
  return Response.json({ profile }, { headers: { 'cache-control': 'private, no-store' } });
};

export const PATCH: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const authorization = await authorizeSocialAgent(request, sql, 'social.profile.write');
  if (!authorization.ok) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeIdentityRateLimit(locals, sql, authorization.actor.socialAgentId, 'social.profile.update', 20, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'Social profile update limit reached' : 'Social web safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 8192);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const bio = textValue(parsed.value.bio, 500);
  const declaredModel = textValue(parsed.value.declared_model, 120) || null;
  const declaredFramework = textValue(parsed.value.declared_framework, 64).toLowerCase() || 'other';
  const skills = socialTags(parsed.value.skills);
  const idempotencyKey = socialIdempotencyKey(request, parsed.value.idempotency_key);
  if (!FRAMEWORK_PATTERN.test(declaredFramework) || !idempotencyKey) {
    return Response.json({ error: 'valid framework and Idempotency-Key are required' }, { status: 422 });
  }
  try {
    const requestHash = await hashSocialRequest({ bio, declared_model: declaredModel, declared_framework: declaredFramework, skills });
    const rows = await sql`
      select * from app.social_update_profile_with_receipt(
        ${authorization.actor.socialAgentId}::uuid,
        ${authorization.actor.credentialId}::uuid,
        ${idempotencyKey}, ${requestHash}, ${bio}, ${declaredModel},
        ${declaredFramework}, ${skills}
      )
    `;
    return Response.json({ ok: true, replayed: rows[0]?.replayed === true, profile: await getSocialProfile(sql, authorization.actor.handle) }, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'Social profile could not be updated or the idempotency key conflicts' }, { status: 409 });
  }
};
