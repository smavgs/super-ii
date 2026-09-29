import { env } from 'cloudflare:workers';
import { cardPhotoSha256, jpegDimensions, stripJpegMetadata } from './card-photo';
import { showcaseMaximumBytes } from './showcase-input';

export { optionalShowcaseUrl, showcaseMaximumBytes, showcaseMaximumSourceBytes } from './showcase-input';

export function showcaseBucket(): R2Bucket | null {
  const bucket = (env as unknown as { SHOWCASE_MEDIA?: R2Bucket }).SHOWCASE_MEDIA;
  return bucket && typeof bucket.get === 'function' && typeof bucket.put === 'function' ? bucket : null;
}

export async function readBoundedShowcasePhoto(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/jpeg') {
    throw new Error('Choose a JPG, PNG, WebP or phone photo');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > showcaseMaximumBytes) throw new Error('The processed image is too large');
  if (!request.body) throw new Error('Choose an image first');
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > showcaseMaximumBytes) {
      await reader.cancel();
      throw new Error('The processed image is too large');
    }
    chunks.push(new Uint8Array(value));
  }
  if (total < 512) throw new Error('The image file is empty or invalid');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function prepareShowcaseBytes(request: Request): Promise<{
  bytes: Uint8Array<ArrayBuffer>;
  contentHash: string;
  width: number;
  height: number;
}> {
  const bytes = stripJpegMetadata(await readBoundedShowcasePhoto(request));
  if (bytes.byteLength > showcaseMaximumBytes) throw new Error('The metadata-free image is too large');
  const dimensions = jpegDimensions(bytes);
  if (dimensions.width < 320 || dimensions.height < 240) {
    throw new Error('Showcase images must be at least 320 by 240 pixels');
  }
  if (dimensions.width > 2_400 || dimensions.height > 2_400) {
    throw new Error('Showcase images must be no larger than 2400 by 2400 pixels');
  }
  if (Math.abs(dimensions.width * 5 - dimensions.height * 8) > 8) {
    throw new Error('Showcase images must be prepared at an 8:5 aspect ratio');
  }
  return { bytes, contentHash: await cardPhotoSha256(bytes), ...dimensions };
}

export async function listPublicShowcase(
  sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>,
  ownerType: 'person' | 'organization',
  ownerId: string,
) {
  return await sql.query(
    `select id, title, caption, alt_text, link_url, position, width, height
     from app.showcase_media
     where robot_id is null and status = 'active'
       and (($1 = 'person' and owner_profile_id = $2::uuid)
         or ($1 = 'organization' and owner_organization_id = $2::uuid))
     order by position limit 3`,
    [ownerType, ownerId],
  ) as Array<{ id: string; title: string; caption: string; alt_text: string; link_url: string | null; position: number; width: number; height: number }>;
}

export async function listRobotShowcase(
  sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>,
  robotId: string,
) {
  return await sql`
    select id, title, caption, alt_text, link_url, position, width, height
    from app.showcase_media
    where robot_id = ${robotId}::uuid and status = 'active'
    order by position limit 3
  ` as Array<{ id: string; title: string; caption: string; alt_text: string; link_url: string | null; position: number; width: number; height: number }>;
}
