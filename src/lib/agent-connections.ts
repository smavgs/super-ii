import type { NeonQueryFunction } from '@neondatabase/serverless';
import { sqlClient } from './db';
import { sha256Hex } from './scoped-auth';
import { bearerChallenge, type ConnectionResource } from './connection-policy';

export function connectionSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export function userCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => alphabet[byte % alphabet.length],
  ).join('');
}
export const privateHeaders = {
  'cache-control': 'private, no-store',
  pragma: 'no-cache',
  'referrer-policy': 'no-referrer',
};
export function connectionJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

export async function inspectConnection(
  sql: NeonQueryFunction<false, false>,
  request: Request,
  resource: ConnectionResource,
) {
  const authorization = request.headers.get('authorization') ?? '';
  const pattern =
    resource === 'work'
      ? /^Bearer (sii_agent_[a-z0-9]{40,128})$/
      : /^Bearer (sii_social_[a-f0-9]{64})$/;
  const token = pattern.exec(authorization)?.[1];
  if (!token) return { status: 'invalid_token', resource } as Record<string, any>;
  const rows =
    await sql`select app.inspect_agent_connection(${await sha256Hex(token)},${resource}) as status`;
  return (rows[0]?.status as Record<string, any>) ?? { status: 'invalid_token', resource };
}

export async function requireConnection(
  locals: App.Locals,
  request: Request,
  resource: ConnectionResource,
  scope?: string,
) {
  const sql = sqlClient(locals);
  const origin = new URL(request.url).origin;
  if (!sql) return connectionJson({ error: 'temporarily_unavailable' }, 503);
  try {
    const status = await inspectConnection(sql, request, resource);
    const verificationRead =
      !scope ||
      [
        'repository:read',
        'robot:read',
        'transparent:read',
        'events:read',
        'receipts:read',
      ].includes(scope);
    if (
      status.status !== 'active' &&
      !(resource === 'work' && status.status === 'action_limit_reached' && verificationRead)
    ) {
      const code = ['invalid_token', 'expired', 'revoked'].includes(status.status) ? 401 : 403;
      return Response.json(
        {
          error: status.status,
          reconnect_uri: `${origin}/account#agents`,
          next_action:
            code === 401
              ? 'Authorize a new connection, then resume the original task.'
              : 'Ask the operator to resolve this access condition.',
        },
        {
          status: code,
          headers: {
            ...privateHeaders,
            'access-control-allow-origin': origin,
            'access-control-expose-headers': 'www-authenticate',
            'www-authenticate': bearerChallenge(origin, resource),
          },
        },
      );
    }
    if (scope && !status.scopes?.includes(scope))
      return Response.json(
        { error: 'insufficient_scope', required_scope: scope },
        {
          status: 403,
          headers: {
            ...privateHeaders,
            'access-control-allow-origin': origin,
            'access-control-expose-headers': 'www-authenticate',
            'www-authenticate': bearerChallenge(origin, resource, scope),
          },
        },
      );
    return null;
  } catch {
    return connectionJson({ error: 'temporarily_unavailable' }, 503);
  }
}
