import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { optionalShowcaseUrl, showcaseBucket } from '@/lib/showcase-media';

const headers = { 'cache-control': 'private, no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const mediaId = params.mediaId ?? '';
  if (!uuidPattern.test(mediaId)) return Response.json({ error: 'Image not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Showcase is unavailable' }, { status: 503, headers });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
  const rate = await consumeRateLimit(locals, request, sql, 'showcase.update', 120, 3_600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Showcase update limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
  const parsed = await readBoundedJsonObject(request, 8_192);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers });
  try {
    const title = typeof parsed.value.title === 'string' ? parsed.value.title.trim() : '';
    const caption = typeof parsed.value.caption === 'string' ? parsed.value.caption.trim() : '';
    const altText = typeof parsed.value.alt_text === 'string' ? parsed.value.alt_text.trim() : '';
    const position = Number(parsed.value.position);
    const linkUrl = optionalShowcaseUrl(parsed.value.link_url);
    if (title.length > 100 || caption.length > 400 || altText.length < 1 || altText.length > 240 || !Number.isInteger(position) || position < 1 || position > 3) {
      return Response.json({ error: 'Check the title, caption, image description, and position' }, { status: 422, headers });
    }
    const rows = await sql`select app.update_showcase_media(${mediaId}::uuid, ${title}, ${caption}, ${altText}, ${linkUrl}, ${position}::smallint) as updated`;
    if (rows[0]?.updated !== true) return Response.json({ error: 'Showcase image not found' }, { status: 404, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Showcase image could not be updated' }, { status: 422, headers });
  }
};

export const DELETE: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const mediaId = params.mediaId ?? '';
  if (!uuidPattern.test(mediaId)) return Response.json({ error: 'Image not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  const bucket = showcaseBucket();
  if (!sql || !bucket) return Response.json({ error: 'Showcase is unavailable' }, { status: 503, headers });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
  const rate = await consumeRateLimit(locals, request, sql, 'showcase.delete', 60, 86_400);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Daily Showcase removal limit reached' : 'Safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
  const target = await sql`select app.showcase_media_delete_target(${mediaId}::uuid) as object_key`;
  const targetKey = target[0]?.object_key ? String(target[0].object_key) : '';
  if (!targetKey) return Response.json({ error: 'Showcase image not found' }, { status: 404, headers });
  try {
    await bucket.delete(targetKey);
  } catch {
    return Response.json({ error: 'Showcase image could not be removed safely' }, { status: 503, headers });
  }
  const rows = await sql`select app.delete_showcase_media(${mediaId}::uuid) as object_key`;
  const objectKey = rows[0]?.object_key ? String(rows[0].object_key) : '';
  if (!objectKey) return Response.json({ error: 'Showcase image removal needs retrying' }, { status: 503, headers });
  return Response.json({ ok: true }, { headers });
};
