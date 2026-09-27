import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { encryptCardValue } from '@/lib/card-crypto';
import { parseCardVault } from '@/lib/cards';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = { 'cache-control': 'private, no-store' };

export const PUT: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Contact details are unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rate = await consumeRateLimit(locals, request, sql, 'cards.vault.update', 60, 3600);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Contact update limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
    const body = await readBoundedJsonObject(request, 32_768);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers });
    const parsed = parseCardVault(body.value);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 422, headers });
    const encrypted = await encryptCardValue(locals, parsed.value, `card-vault:${profile.profileId}`);
    await sql`
      insert into app.card_contact_vaults (profile_id, ciphertext, iv, key_version)
      values (${profile.profileId}::uuid, ${encrypted.ciphertext}, ${encrypted.iv}, 'v1')
      on conflict (profile_id) do update set
        ciphertext = excluded.ciphertext, iv = excluded.iv,
        key_version = excluded.key_version, updated_at = now()
    `;
    return Response.json({ ok: true, vault: parsed.value }, { headers });
  } catch {
    return Response.json({ error: 'Contact details could not be saved' }, { status: 503, headers });
  }
};
