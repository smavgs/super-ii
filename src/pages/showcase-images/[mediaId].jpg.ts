import type { APIRoute } from 'astro';
import { waitUntil } from 'cloudflare:workers';
import { sqlClient } from '@/lib/db';
import { showcaseBucket } from '@/lib/showcase-media';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const baseHeaders = {
  'cache-control': 'public, max-age=300, must-revalidate',
  'content-disposition': 'inline',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

function clientResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', baseHeaders['cache-control']);
  const etag = headers.get('etag');
  const validators = request.headers.get('if-none-match')?.split(',').map((value) => value.trim()) ?? [];
  if (etag && (validators.includes(etag) || validators.includes('*'))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const mediaId = params.mediaId ?? '';
  if (!uuidPattern.test(mediaId)) return new Response('Not found', { status: 404, headers: baseHeaders });
  const sql = sqlClient(locals);
  const bucket = showcaseBucket();
  if (!sql || !bucket) return new Response('Unavailable', { status: 503, headers: baseHeaders });
  try {
    const rows = await sql`select * from app.resolve_public_showcase_media(${mediaId}::uuid)`;
    const media = rows[0] as { object_key: string; content_hash: string; mime_type: string } | undefined;
    if (!media) return new Response('Not found', { status: 404, headers: baseHeaders });
    const cacheStorage = typeof caches === 'undefined'
      ? null
      : caches as CacheStorage & { default: Cache };
    const cache = cacheStorage?.default ?? null;
    const cacheKey = new Request(
      new URL(`/__superii-showcase-cache/${media.content_hash}.jpg`, request.url),
      { method: 'GET' },
    );
    if (cache) {
      try {
        const cached = await cache.match(cacheKey);
        if (cached) return clientResponse(cached, request);
      } catch (error) {
        console.warn('Showcase edge cache read failed', {
          kind: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    const object = await bucket.get(media.object_key);
    if (!object) return new Response('Not found', { status: 404, headers: baseHeaders });
    const responseHeaders = new Headers(baseHeaders);
    object.writeHttpMetadata(responseHeaders);
    responseHeaders.set('content-type', media.mime_type);
    responseHeaders.set('etag', object.httpEtag);
    responseHeaders.set('cache-control', 'public, max-age=2592000, immutable');
    const response = new Response(object.body, { headers: responseHeaders });
    if (cache) {
      waitUntil(cache.put(cacheKey, response.clone()).catch((error: unknown) => {
        console.warn('Showcase edge cache write failed', {
          kind: error instanceof Error ? error.name : 'UnknownError',
        });
      }));
    }
    return clientResponse(response, request);
  } catch {
    return new Response('Unavailable', { status: 503, headers: baseHeaders });
  }
};
