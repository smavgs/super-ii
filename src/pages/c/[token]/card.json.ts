import type { APIRoute } from 'astro';
import { loadPublicCardByToken } from '@/lib/card-data';

export const GET: APIRoute = async ({ locals, params }) => {
  const card = await loadPublicCardByToken(locals, params.token ?? '');
  if (!card) return Response.json({ error: 'Card not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return Response.json({
    schema: 'https://superii.site/schemas/card/v1.json',
    revision: card.revision,
    card: card.snapshot,
  }, { headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' } });
};
