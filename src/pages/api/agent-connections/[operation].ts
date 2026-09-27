import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';
import { sha256Hex } from '@/lib/scoped-auth';
import { connectionJson, connectionSecret } from '@/lib/agent-connections';
import { UUID } from '@/lib/connection-policy';

export const ALL: APIRoute = async ({ locals, request, url, params }) => {
  if (request.method !== 'GET' && (request.method !== 'POST' || !sameOrigin(request)))
    return connectionJson({ error: 'invalid_origin_or_method' }, 403);
  const sql = sqlClient(locals);
  if (!sql) return connectionJson({ error: 'temporarily_unavailable' }, 503);
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return connectionJson({ error: 'authentication_required' }, 401);
  const rate = await consumeIdentityRateLimit(
    locals,
    sql,
    profile.profileId,
    'connection.manage',
    120,
    3600,
  );
  if (rate !== 'allowed')
    return connectionJson(
      { error: rate === 'limited' ? 'rate_limited' : 'temporarily_unavailable' },
      rate === 'limited' ? 429 : 503,
    );
  try {
    if (request.method === 'GET' && params.operation === 'list') {
      const rows = await sql`select app.list_agent_connections() as connections`;
      return connectionJson(rows[0]);
    }
    if (request.method === 'GET' && params.operation === 'request') {
      const id = url.searchParams.get('request');
      const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(/-/g, '');
      if ((!id || !UUID.test(id)) && !/^[A-Z2-9]{8}$/.test(code))
        return connectionJson({ error: 'invalid_request' }, 400);
      const rows =
        await sql`select app.read_agent_connection_request(${id && UUID.test(id) ? id : null}::uuid,${code ? await sha256Hex(code) : null}) as request`;
      return rows[0]?.request
        ? connectionJson(rows[0])
        : connectionJson(
            {
              error: 'request_expired_or_used',
              message:
                'This request has expired or already been used. Start a new connection from your agent.',
            },
            404,
          );
    }
    if (request.method !== 'POST') return connectionJson({ error: 'not_found' }, 404);
    const parsed = await readBoundedJsonObject(request, 16_384);
    if (!parsed.ok) return connectionJson({ error: 'invalid_request' }, 400);
    const body = parsed.value;
    if (typeof body.id !== 'string' || !UUID.test(body.id))
      return connectionJson({ error: 'invalid_request' }, 400);
    if (params.operation === 'revoke') {
      const rows = await sql`select app.revoke_agent_connection(${body.id}::uuid) as ok`;
      return connectionJson(rows[0], rows[0]?.ok ? 200 : 404);
    }
    if (params.operation !== 'approve' || typeof body.allow !== 'boolean')
      return connectionJson({ error: 'invalid_request' }, 400);
    const code = connectionSecret();
    const rows =
      await sql`select app.approve_agent_connection(${body.id}::uuid,${profile.profileId}::uuid,${body.allow},${JSON.stringify(body.options ?? {})}::jsonb,${await sha256Hex(code)}) as result`;
    const result = rows[0]?.result;
    let redirect: string | null = null;
    if (result?.redirect_uri) {
      const target = new URL(result.redirect_uri);
      target.searchParams.set(body.allow ? 'code' : 'error', body.allow ? code : 'access_denied');
      if (result.state != null) target.searchParams.set('state', result.state);
      target.searchParams.set('iss', url.origin);
      redirect = target.href;
    }
    return connectionJson({ ok: true, approved: body.allow, redirect_uri: redirect });
  } catch {
    return connectionJson(
      {
        error: 'approval_failed',
        message:
          'Check the identity, sponsorship, permissions and limits. The request may have expired or already been used.',
      },
      409,
    );
  }
};
