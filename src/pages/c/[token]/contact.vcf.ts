import type { APIRoute } from 'astro';
import { loadPublicCardByToken } from '@/lib/card-data';
import { cardVcard } from '@/lib/cards';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const card = await loadPublicCardByToken(locals, params.token ?? '');
  if (!card) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const locale = new URL(request.url).searchParams.get('language') === 'zh-CN' ? 'zh-CN' : 'en';
  const filename = card.snapshot.identity_en.name.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'super-ii-card';
  return new Response(cardVcard(card.snapshot, locale), { headers: {
    'content-type': 'text/vcard; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}.vcf"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  } });
};
