import type { NeonQueryFunction } from '@neondatabase/serverless';
import { runtimeValue } from './db';

export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const networkHash = await sha256(`${salt}:${network}`);
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
