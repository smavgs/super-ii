import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { encryptCardValue } from '@/lib/card-crypto';
import {
  cardPhotoBytesToBase64Url, cardPhotoSha256, jpegDimensions,
  readBoundedCardPhoto, stripJpegMetadata,
} from '@/lib/card-photo';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = { 'cache-control': 'private, no-store' };

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Photo upload is unavailable' }, { status: 503, headers });
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
    const rate = await consumeRateLimit(locals, request, sql, 'cards.photo.upload', 30, 86_400);
    if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Daily photo upload limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });

    const stripped = stripJpegMetadata(await readBoundedCardPhoto(request));
    jpegDimensions(stripped);
    const contentHash = await cardPhotoSha256(stripped);
    const existing = await sql`
      select id from app.card_photos
      where owner_profile_id = ${profile.profileId}::uuid and content_hash = ${contentHash}
      limit 1
    `;
    const existingId = existing[0]?.id ? String(existing[0].id) : '';
    if (existingId) {
      return Response.json({
        photo_url: `https://superii.site/card-images/${existingId}.jpg`,
        preview_url: `/api/cards/photos/${existingId}`,
      }, { headers });
    }

    const countRows = await sql`select count(*)::integer as count from app.card_photos where owner_profile_id = ${profile.profileId}::uuid`;
    if (Number(countRows[0]?.count ?? 0) >= 48) {
      return Response.json({ error: 'Photo library limit reached. Please contact Super ii support.' }, { status: 409, headers });
    }
    const photoId = crypto.randomUUID();
    const encrypted = await encryptCardValue(
      locals,
      cardPhotoBytesToBase64Url(stripped),
      `card-photo:${profile.profileId}:${photoId}`,
    );
    const inserted = await sql`
      insert into app.card_photos (
        id, owner_profile_id, content_hash, mime_type, byte_size, ciphertext, iv
      ) values (
        ${photoId}::uuid, ${profile.profileId}::uuid, ${contentHash}, 'image/jpeg',
        ${stripped.byteLength}, ${encrypted.ciphertext}, ${encrypted.iv}
      )
      on conflict (owner_profile_id, content_hash) do nothing
      returning id
    `;
    const storedId = inserted[0]?.id
      ? String(inserted[0].id)
      : String((await sql`
          select id from app.card_photos
          where owner_profile_id = ${profile.profileId}::uuid and content_hash = ${contentHash}
          limit 1
        `)[0]?.id ?? '');
    if (!storedId) throw new Error('card photo deduplication failed');
    return Response.json({
      photo_url: `https://superii.site/card-images/${storedId}.jpg`,
      preview_url: `/api/cards/photos/${storedId}`,
    }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The photo')) {
      return Response.json({ error: error.message }, { status: 422, headers });
    }
    if (error instanceof Error && error.message.startsWith('Choose a')) {
      return Response.json({ error: error.message }, { status: 422, headers });
    }
    if (error instanceof Error && error.message.startsWith('Photo dimensions')) {
      return Response.json({ error: error.message }, { status: 422, headers });
    }
    return Response.json({ error: 'Photo could not be saved' }, { status: 503, headers });
  }
};
