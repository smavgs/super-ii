import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { decryptCardValue } from '@/lib/card-crypto';
import { cardPhotoBase64UrlToBytes } from '@/lib/card-photo';
import { sqlClient } from '@/lib/db';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export const GET: APIRoute = async ({ locals, params }) => {
  const photoId = params.photoId ?? '';
  if (!uuidPattern.test(photoId)) return new Response('Not found', { status: 404, headers: privateHeaders });
  const sql = sqlClient(locals);
  if (!sql) return new Response('Unavailable', { status: 503, headers: privateHeaders });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return new Response('Authentication required', { status: 401, headers: privateHeaders });
    const rows = await sql`
      select ciphertext, iv, mime_type from app.card_photos
      where id = ${photoId}::uuid and owner_profile_id = ${profile.profileId}::uuid
      limit 1
    `;
    const photo = rows[0] as { ciphertext: string; iv: string; mime_type: string } | undefined;
    if (!photo) return new Response('Not found', { status: 404, headers: privateHeaders });
    const encoded = await decryptCardValue<string>(locals, photo, `card-photo:${profile.profileId}:${photoId}`);
    return new Response(cardPhotoBase64UrlToBytes(encoded), {
      headers: { ...privateHeaders, 'content-type': photo.mime_type, 'content-disposition': 'inline' },
    });
  } catch {
    return new Response('Unavailable', { status: 503, headers: privateHeaders });
  }
};

