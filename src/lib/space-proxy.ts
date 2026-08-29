import type { NeonQueryFunction } from '@neondatabase/serverless';
import { consumeRateLimit } from './rate-limit';
import { runtimeFetch } from './runtime';
import { publishedRevisionId } from './runtime-repository';

const REQUEST_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'content-type',
  'if-modified-since',
  'if-none-match',
  'last-event-id',
  'range',
]);
const RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'location',
]);

function copyHeaders(source: Headers, allowed: Set<string>): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}

export async function proxyPublishedSpace(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  repositoryId: string,
  path: string,
): Promise<Response> {
  const revisionId = await publishedRevisionId(sql, repositoryId, 'space');
  if (!revisionId) return Response.json({ error: 'Space not found' }, { status: 404 });
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, last-event-id, range',
        'access-control-max-age': '86400',
      },
    });
  }
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return Response.json({ error: 'WebSocket Spaces are not enabled; Gradio uses streaming HTTP' }, { status: 501 });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const rateLimit = await consumeRateLimit(locals, request, sql, 'space_compute', 240, 3600);
    if (rateLimit === 'limited') {
      return Response.json({ error: 'Space compute rate limit reached' }, { status: 429, headers: { 'retry-after': '3600' } });
    }
    if (rateLimit === 'unavailable') {
      return Response.json({ error: 'Space safety service unavailable' }, { status: 503 });
    }
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) {
    return Response.json({ error: 'invalid Space path' }, { status: 400 });
  }
  const encodedPath = parts.map(encodeURIComponent).join('/');
  const query = new URL(request.url).search;
  const runtimePath = `/v1/repositories/${repositoryId}/revisions/${revisionId}/space/proxy${encodedPath ? `/${encodedPath}` : ''}${query}`;
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 32 * 1024 * 1024) {
    return Response.json({ error: 'Space request is too large' }, { status: 413 });
  }
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 32 * 1024 * 1024) {
    return Response.json({ error: 'Space request is too large' }, { status: 413 });
  }
  const upstream = await runtimeFetch(locals, runtimePath, {
    method: request.method,
    headers: copyHeaders(request.headers, REQUEST_HEADERS),
    body,
    redirect: 'manual',
  });
  if (!upstream) return Response.json({ error: 'Space runtime unavailable' }, { status: 503 });
  const headers = copyHeaders(upstream.headers, RESPONSE_HEADERS);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('content-security-policy', "frame-ancestors 'self'");
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', 'content-length, content-range, content-type, etag');
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
