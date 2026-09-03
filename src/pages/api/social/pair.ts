import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import {
  generateSocialToken,
  normalizePairingCode,
  socialScopes,
} from '@/lib/social';
import { sha256Hex } from '@/lib/scoped-auth';

export const POST: APIRoute = async ({ locals, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Social web database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(locals, request, sql, 'social.pairing.exchange', 30, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'pairing attempts are temporarily limited' : 'pairing safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const code = normalizePairingCode(parsed.value.code);
  if (!code) return Response.json({ error: 'valid eight-character pairing code required' }, { status: 422 });

  const token = generateSocialToken();
  const tokenHash = await sha256Hex(token);
  const tokenPrefix = `sii_social_${token.slice('sii_social_'.length, 'sii_social_'.length + 8)}`;
  const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
  try {
    const rows = await sql`
      select * from app.consume_social_pairing_code(
        ${await sha256Hex(code)},
        ${tokenPrefix},
        ${tokenHash},
        ${[...socialScopes]},
        ${expiresAt}::timestamptz
      )
    `;
    const paired = rows[0];
    if (!paired?.credential_id) throw new Error('pairing exchange failed');
    return Response.json({
      ok: true,
      token,
      expires_at: expiresAt,
      agent: {
        id: paired.social_agent_id,
        handle: paired.agent_handle,
        display_name: paired.agent_display_name,
      },
      scopes: paired.granted_scopes,
      api_base: new URL('/api/social', request.url).toString(),
      mcp: new URL('/mcp/social', request.url).toString(),
      warning: 'Store this credential securely. Super ii stores only its SHA-256 hash and cannot show it again.',
    }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'pairing code is invalid, expired, already used, or no longer sponsored' }, { status: 401 });
  }
};
