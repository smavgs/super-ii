import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { prepareShowcaseBytes, showcaseBucket } from '@/lib/showcase-media';

const headers = { 'cache-control': 'private, no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const POST: APIRoute = async ({ locals, request, url }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const sql = sqlClient(locals);
  const bucket = showcaseBucket();
  if (!sql || !bucket) return Response.json({ error: 'Showcase upload is unavailable' }, { status: 503, headers });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
  const remaining = await sql`select app.showcase_uploads_remaining() as remaining`;
  if (Number(remaining[0]?.remaining ?? 0) < 1) {
    return Response.json({ error: 'All three Showcase uploads have been used' }, { status: 409, headers });
  }
  const organizationId = url.searchParams.get('organization_id');
  const robotId = url.searchParams.get('robot_id');
  const altText = (url.searchParams.get('alt_text') ?? '').trim();
  if ((organizationId && !uuidPattern.test(organizationId)) || (robotId && !uuidPattern.test(robotId)) || altText.length < 1 || altText.length > 240) {
    return Response.json({ error: 'Describe the image and choose a valid owner' }, { status: 422, headers });
  }
  let objectKey = '';
  try {
    const prepared = await prepareShowcaseBytes(request);
    const rate = await consumeRateLimit(locals, request, sql, 'showcase.upload', 3, 86_400);
    if (rate !== 'allowed') {
      return Response.json({ error: rate === 'limited' ? 'Please wait before trying another image' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
    }
    const capacity = await sql`select app.showcase_storage_available(${prepared.bytes.byteLength}) as allowed`;
    if (capacity[0]?.allowed !== true) {
      return Response.json(
        { error: 'Showcase uploads are temporarily paused' },
        { status: 507, headers },
      );
    }
    const ownerKind = organizationId ? 'organization' : 'profile';
    const ownerId = organizationId ?? profile.profileId;
    objectKey = `showcase/${ownerKind}/${ownerId}/${crypto.randomUUID()}.jpg`;
    await bucket.put(objectKey, prepared.bytes, {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=300, must-revalidate' },
      customMetadata: { sha256: prepared.contentHash },
      storageClass: 'Standard',
    });
    const rows = await sql`
      select * from app.create_showcase_media(
        ${organizationId}::uuid, ${robotId}::uuid, ${objectKey}, ${prepared.contentHash},
        ${prepared.bytes.byteLength}, ${prepared.width}, ${prepared.height},
        '', '', ${altText}, null
      )
    `;
    const item = rows[0] as { media_id?: string; media_position?: number } | undefined;
    if (!item?.media_id) throw new Error('showcase_media_not_saved');
    return Response.json({
      ok: true,
      item: {
        id: item.media_id, title: '', caption: '', alt_text: altText, link_url: null,
        position: Number(item.media_position), width: prepared.width, height: prepared.height,
        image_url: `/showcase-images/${item.media_id}.jpg`,
      },
    }, { status: 201, headers });
  } catch (error) {
    if (objectKey) await bucket.delete(objectKey).catch(() => undefined);
    const message = error instanceof Error ? error.message : '';
    if (/^(Choose|The image|The processed|The metadata|Showcase images)/u.test(message)) {
      return Response.json({ error: message }, { status: 422, headers });
    }
    if (message.includes('limit_reached')) return Response.json({ error: 'All three Showcase uploads have been used' }, { status: 409, headers });
    if (message.includes('storage_limit')) return Response.json({ error: 'Showcase uploads are temporarily paused' }, { status: 507, headers });
    if (message.includes('permission_denied')) return Response.json({ error: 'You cannot add images to this owner' }, { status: 403, headers });
    return Response.json({ error: 'Showcase image could not be saved' }, { status: 503, headers });
  }
};
