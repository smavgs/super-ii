import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { loadPublicCardByToken } from '@/lib/card-data';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const token = params.token ?? '';
  const card = await loadPublicCardByToken(locals, token);
  if (!card) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const url = new URL(`/c/${token}`, request.url).toString();
  const svg = await QRCode.toString(url, {
    type: 'svg', errorCorrectionLevel: 'H', margin: 2,
    color: { dark: '#071a2f', light: '#ffffff' }, width: 720,
  });
  return new Response(svg, { headers: {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
  } });
};
