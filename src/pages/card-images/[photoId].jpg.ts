import type { APIRoute } from 'astro';
import { decryptCardValue } from '@/lib/card-crypto';
import { cardPhotoBase64UrlToBytes } from '@/lib/card-photo';
import { sqlClient } from '@/lib/db';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const publicHeaders = {
  'cache-control': 'private, no-store',
  'content-disposition': 'inline',
  'cross-origin-resource-policy': 'cross-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export const GET: APIRoute = async ({ locals, params }) => {
  const photoId = params.photoId ?? '';
  if (!uuidPattern.test(photoId)) return new Response('Not found', { status: 404, headers: publicHeaders });
  const sql = sqlClient(locals);
  if (!sql) return new Response('Unavailable', { status: 503, headers: publicHeaders });
  try {
    const rows = await sql`select * from app.resolve_public_card_photo(${photoId}::uuid)`;
    const photo = rows[0] as { owner_profile_id: string; ciphertext: string; iv: string; mime_type: string } | undefined;
    if (!photo) return new Response('Not found', { status: 404, headers: publicHeaders });
    const encoded = await decryptCardValue<string>(
      locals,
      photo,
      `card-photo:${photo.owner_profile_id}:${photoId}`,
    );
    return new Response(cardPhotoBase64UrlToBytes(encoded), {
      headers: { ...publicHeaders, 'content-type': photo.mime_type },
    });
  } catch {
    return new Response('Unavailable', { status: 503, headers: publicHeaders });
  }
};

