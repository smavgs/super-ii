import type { NeonQueryFunction } from '@neondatabase/serverless';
import { runtimeValue } from './db';

export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function requestNetworkHash(
  locals: App.Locals,
  request: Request,
  purpose = 'request',
): Promise<string | null> {
  const salt = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!salt) return null;
  const network = request.headers.get('cf-connecting-ip') ?? 'local-or-unknown';
  const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? 'unknown-agent';
  return sha256(`${salt}:${purpose}:${network}:${userAgent}`);
}

async function consumeHashedRateLimit(
  networkHash: string,
  sql: NeonQueryFunction<false, false>,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const rows = await sql`
      select app.consume_request_limit(
        ${networkHash},
        ${action},
        ${limit},
        ${windowSeconds}
      ) as allowed
    `;
    return rows[0]?.allowed === true ? 'allowed' : 'limited';
  } catch {
    return 'unavailable';
  }
}

export async function consumeRateLimit(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const salt = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!salt) return 'unavailable';
  const network = request.headers.get('cf-connecting-ip') ?? 'local-or-unknown';
  return consumeHashedRateLimit(
    await sha256(`${salt}:${network}`),
    sql,
    action,
    limit,
    windowSeconds,
  );
}

export async function consumeIdentityRateLimit(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  identity: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const salt = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!salt || !identity) return 'unavailable';
  return consumeHashedRateLimit(
    await sha256(`${salt}:identity:${identity}`),
    sql,
    action,
    limit,
    windowSeconds,
  );
}
