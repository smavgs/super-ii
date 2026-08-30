import type { APIRoute } from 'astro';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { repositoryScopes, sha256Hex, type RepositoryScope } from '@/lib/scoped-auth';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'https://superii.site';
const githubJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));

function opaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sii_${hex}`;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'trusted-publisher.exchange', 60, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'trusted publishing exchange limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'GitHub OIDC bearer token required' }, { status: 401 });
  }
  const oidcToken = authorization.slice('Bearer '.length).trim();
  if (oidcToken.length < 100 || oidcToken.length > 20_000) {
    return Response.json({ error: 'invalid GitHub OIDC token' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const repositoryId = typeof body.repository_id === 'string' ? body.repository_id : '';
  const requestedScopes = Array.isArray(body.scopes)
    ? [...new Set(body.scopes.filter((value): value is string => typeof value === 'string'))]
    : [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(repositoryId)) {
    return Response.json({ error: 'valid repository_id required' }, { status: 422 });
  }
  if (!requestedScopes.length || requestedScopes.length > repositoryScopes.length || requestedScopes.some((scope) => !repositoryScopes.includes(scope as RepositoryScope))) {
    return Response.json({ error: 'valid bounded scopes required' }, { status: 422 });
  }

  let verified: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    const protectedHeader = decodeProtectedHeader(oidcToken);
    if (protectedHeader.alg !== 'RS256' || typeof protectedHeader.kid !== 'string') throw new Error('unexpected token header');
    verified = (await jwtVerify(oidcToken, githubJwks, {
      issuer,
      audience,
      algorithms: ['RS256'],
      maxTokenAge: '10 minutes',
      clockTolerance: '5 seconds',
    })).payload;
  } catch {
    return Response.json({ error: 'GitHub OIDC signature or claims are invalid' }, { status: 401 });
  }
  const subject = typeof verified.sub === 'string' ? verified.sub : '';
  const workflowRef = typeof verified.job_workflow_ref === 'string' ? verified.job_workflow_ref : null;
  if (verified.iss !== issuer || !subject || !subject.startsWith('repo:')) {
    return Response.json({ error: 'GitHub OIDC issuer or subject is not trusted' }, { status: 403 });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof verified.iat !== 'number'
    || typeof verified.exp !== 'number'
    || verified.exp <= nowSeconds + 15
    || verified.exp > nowSeconds + 600
    || verified.iat < nowSeconds - 600
  ) {
    return Response.json({ error: 'GitHub OIDC token lifetime is outside the accepted window' }, { status: 401 });
  }
  const repositoryClaim = typeof verified.repository === 'string' ? verified.repository : '';
  const subjectRepository = subject.split(':')[1] ?? '';
  if (!repositoryClaim || repositoryClaim.toLowerCase() !== subjectRepository.toLowerCase()) {
    return Response.json({ error: 'GitHub repository claim does not match the trusted subject' }, { status: 403 });
  }

  let publisher: Record<string, unknown> | undefined;
  try {
    const rows = await sql`
      select publisher.id, publisher.repository_id, publisher.subject, publisher.audience,
             publisher.workflow_ref, publisher.allowed_scopes, publisher.created_by_profile_id
      from app.trusted_publishers publisher
      join app.repositories repository on repository.id = publisher.repository_id
      where publisher.repository_id = ${repositoryId}::uuid
        and publisher.provider = 'github-actions'
        and publisher.issuer = ${issuer}
        and publisher.subject = ${subject}
        and publisher.audience = ${audience}
        and publisher.enabled
        and (publisher.workflow_ref is null or publisher.workflow_ref = ${workflowRef})
      limit 1
    `;
    publisher = rows[0];
  } catch {
    return Response.json({ error: 'trusted publishing service unavailable' }, { status: 503 });
  }
  if (!publisher) return Response.json({ error: 'no matching trusted publisher' }, { status: 403 });
  const allowedScopes = Array.isArray(publisher.allowed_scopes)
    ? publisher.allowed_scopes.filter((value): value is string => typeof value === 'string')
    : [];
  if (requestedScopes.some((scope) => !allowedScopes.includes(scope))) {
    return Response.json({ error: 'requested scope is not allowed for this publisher' }, { status: 403 });
  }

  if (publisher.workflow_ref && verified.job_workflow_ref !== publisher.workflow_ref) {
    return Response.json({ error: 'GitHub workflow claim does not match the trusted workflow' }, { status: 403 });
  }

  const token = opaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Math.min(verified.exp * 1000, Date.now() + 10 * 60 * 1000)).toISOString();
  try {
    const rows = await sql`
      insert into app.scoped_access_tokens (
        repository_id, trusted_publisher_id, created_by_profile_id,
        token_prefix, token_hash, scopes, expires_at
      ) values (
        ${repositoryId}::uuid,
        ${String(publisher.id)}::uuid,
        ${String(publisher.created_by_profile_id)}::uuid,
        ${token.slice(0, 12)},
        ${tokenHash},
        ${JSON.stringify(requestedScopes)}::jsonb,
        ${expiresAt}::timestamptz
      )
      returning id
    `;
    await sql`
      insert into app.audit_events (actor_id, action, target_type, target_id, metadata)
      values (
        ${`trusted-publisher:${String(publisher.id)}`},
        'trusted_publisher.token_issued',
        'repository',
        ${repositoryId},
        ${JSON.stringify({ token_id: String(rows[0].id), scopes: requestedScopes, expires_at: expiresAt })}::jsonb
      )
    `;
    return Response.json({
      access_token: token,
      token_type: 'Bearer',
      expires_at: expiresAt,
      scopes: requestedScopes,
      repository_id: repositoryId,
    }, { status: 201, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
  } catch {
    return Response.json({ error: 'scoped access token could not be issued' }, { status: 503 });
  }
};
