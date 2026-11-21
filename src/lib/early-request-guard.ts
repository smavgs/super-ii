// Cheap per-location admission before Astro, Clerk or PostgreSQL. Durable identity
// quotas still authorize the underlying operation; these counters are not a bill cap.
type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
export type EarlyGuardEnv = {
  REQUEST_RATE_LIMITER?: Limiter;
  WRITE_RATE_LIMITER?: Limiter;
  CONTACT_HASH_SALT?: string;
};

export function protocolBodyLimit(path: string): number | null {
  if (path === '/api/handles/check') return 256;
  if (path === '/api/experience/events') return 512;
  if (path === '/mcp' || path.startsWith('/mcp/')) return 1_048_576;
  if (path.startsWith('/a2a/')) return 65_536;
  if (path.startsWith('/oauth/') || path.startsWith('/api/oauth/')) return 16_384;
  if (path === '/api/assistant/chat') return 96_000;
  return null; // Binary uploads and streamed downloads keep their own limits.
}

function refusal(error: string, status: number, retry?: string): Response {
  return Response.json({ error }, { status, headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Retry-After',
    ...(retry ? { 'retry-after': retry } : {}),
  } });
}

export async function prepareEarlyRequest(request: Request, env: EarlyGuardEnv): Promise<Request | Response> {
  const url = new URL(request.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !['superii.site', 'www.superii.site'].includes(url.hostname)) {
    return refusal('unrecognized_host', 421);
  }
  if (url.pathname.length > 2048 || url.search.length > 16_384) return refusal('request_uri_too_long', 414);
  const maxBytes = protocolBodyLimit(url.pathname);
  if (maxBytes !== null && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
      return refusal('invalid_content_length', 400);
    }
    if (declared !== null && Number(declared) > maxBytes) return refusal('request_too_large', 413);
  }
  if (!local) {
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip || !env.CONTACT_HASH_SALT || !env.REQUEST_RATE_LIMITER || !env.WRITE_RATE_LIMITER) {
      return refusal('request_safety_service_unavailable', 503, '30');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.CONTACT_HASH_SALT}:edge:${ip}`));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    try {
      if (!(await env.REQUEST_RATE_LIMITER.limit({ key })).success) return refusal('rate_limited', 429, '60');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !(await env.WRITE_RATE_LIMITER.limit({ key })).success) return refusal('rate_limited', 429, '60');
    } catch { return refusal('request_safety_service_unavailable', 503, '30'); }
  }
  if (maxBytes === null || ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !request.body) return request;
  // Count actual streamed bytes; Content-Length alone is not a body boundary.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error('body_timeout')); }, 30_000);
    });
    const bytes = await Promise.race([timeout, (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) return null;
        chunks.push(chunk.value);
      }
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    })()]);
    if (bytes === null) return refusal('request_too_large', 413);
    const headers = new Headers(request.headers);
    headers.set('content-length', String(bytes.byteLength));
    return new Request(request, { headers, body: bytes });
  } catch { return refusal(timedOut ? 'request_body_timeout' : 'invalid_request_body', timedOut ? 408 : 400); }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
