import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeIdentityRateLimit, consumeRateLimit } from '@/lib/rate-limit';

function proposalSlug(title: string): string {
  const base = title.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'proposal';
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${base}-${suffix}`;
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'proposal database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const [networkRate, identityRate] = await Promise.all([
    consumeRateLimit(locals, request, sql, 'proposal.create', 10, 86400),
    consumeIdentityRateLimit(locals, sql, profile.profileId, 'proposal.create.identity', 3, 86400),
  ]);
  if (networkRate !== 'allowed' || identityRate !== 'allowed') {
    const limited = networkRate === 'limited' || identityRate === 'limited';
    return Response.json({ error: limited ? 'proposal daily limit reached' : 'safety service unavailable' }, {
      status: limited ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 16_384);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const title = textValue(parsed.value.title, 160);
  const summary = textValue(parsed.value.summary, 360);
  const body = textValue(parsed.value.body, 12_000);
  if (title.length < 5 || summary.length < 10) {
    return Response.json({ error: 'title and short explanation are required' }, { status: 422 });
  }
  try {
    const rows = await sql`
      select * from app.create_public_proposal(
        ${profile.profileId}::uuid, ${proposalSlug(title)}, ${title}, ${summary}, ${body}
      )
    `;
    const proposal = rows[0];
    return Response.json({
      ok: true,
      proposal,
      href: proposal?.slug ? `/proposals/${proposal.slug}` : '/proposals',
    }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message.includes('daily') ? 'proposal daily limit reached' : 'proposal could not be created' }, {
      status: message.includes('daily') ? 429 : 409,
    });
  }
};
