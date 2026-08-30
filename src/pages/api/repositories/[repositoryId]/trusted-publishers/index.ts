import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository, textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { repositoryScopes, type RepositoryScope } from '@/lib/scoped-auth';

const githubSubjectPattern = /^repo:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:(?:ref:refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+|environment:[^\r\n]{1,200}|pull_request)$/;
const workflowPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9._/-]+@refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/;
const canonicalAudience = 'https://superii.site';

async function owner(
  locals: App.Locals,
  repositoryId: string,
  request: Request,
  requireSameOrigin = true,
) {
  if (requireSameOrigin && !sameOrigin(request)) return { error: 'invalid origin', status: 403 as const };
  const sql = sqlClient(locals);
  if (!sql) return { error: 'database unavailable', status: 503 as const };
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return { error: 'authentication required', status: 401 as const };
  const repository = await managedRepository(sql, repositoryId, profile.profileId);
  if (!repository) return { error: 'repository not found or access denied', status: 404 as const };
  return { sql, profile, repository };
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const authorization = await owner(locals, params.repositoryId ?? '', request, false);
  if ('error' in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });
  try {
    const publishers = await authorization.sql`
      select id, provider, issuer, subject, audience, workflow_ref, allowed_scopes,
             enabled, last_used_at, created_at, updated_at
      from app.trusted_publishers
      where repository_id = ${authorization.repository.id}::uuid
      order by created_at desc
    `;
    return Response.json({ publishers }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'trusted publishers unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  const authorization = await owner(locals, params.repositoryId ?? '', request);
  if ('error' in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });
  const rate = await consumeRateLimit(locals, request, authorization.sql, 'trusted-publisher.configure', 30, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'trusted publisher configuration limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const subject = textValue(body.subject, 500);
  const workflowRef = textValue(body.workflow_ref, 1000) || null;
  const requestedScopes = Array.isArray(body.allowed_scopes)
    ? [...new Set(body.allowed_scopes.map((value) => textValue(value, 80)).filter(Boolean))]
    : ['repository:upload', 'repository:commit', 'repository:submit'];
  const allowedScopes = requestedScopes.filter((scope): scope is RepositoryScope => repositoryScopes.includes(scope as RepositoryScope));
  if (!githubSubjectPattern.test(subject)) {
    return Response.json({ error: 'GitHub subject must bind one repository to a branch, tag, environment, or pull request' }, { status: 422 });
  }
  if (workflowRef && !workflowPattern.test(workflowRef)) {
    return Response.json({ error: 'workflow ref must bind an exact GitHub workflow file and branch or tag' }, { status: 422 });
  }
  if (!allowedScopes.length || allowedScopes.length !== requestedScopes.length) {
    return Response.json({ error: 'one or more trusted publishing scopes are invalid' }, { status: 422 });
  }
  try {
    const rows = await authorization.sql`
      insert into app.trusted_publishers (
        repository_id, provider, issuer, subject, audience, workflow_ref,
        allowed_scopes, created_by_profile_id, enabled
      ) values (
        ${authorization.repository.id}::uuid,
        'github-actions',
        'https://token.actions.githubusercontent.com',
        ${subject},
        ${canonicalAudience},
        ${workflowRef},
        ${JSON.stringify(allowedScopes)}::jsonb,
        ${authorization.profile.profileId}::uuid,
        true
      )
      on conflict (repository_id, provider, issuer, subject, audience)
      do update set
        workflow_ref = excluded.workflow_ref,
        allowed_scopes = excluded.allowed_scopes,
        enabled = true,
        updated_at = now()
      returning id, provider, issuer, subject, audience, workflow_ref, allowed_scopes, enabled, created_at
    `;
    return Response.json({
      ok: true,
      publisher: rows[0],
      exchange_url: 'https://superii.site/api/trusted-publishing/github/exchange',
      token_lifetime_seconds: 600,
      note: 'The exchange returns the opaque scoped token once. Do not log or persist it.',
    }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'trusted publisher could not be saved' }, { status: 409 });
  }
};
