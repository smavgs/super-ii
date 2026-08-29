import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

const withClerk = clerkMiddleware();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: https://img.clerk.com https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

function isolatedSpaceCsp(origin: string): string {
  return [
    `default-src ${origin}`,
    `script-src ${origin} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:`,
    `connect-src ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `style-src ${origin} 'unsafe-inline'`,
    `media-src ${origin} data: blob:`,
    `worker-src ${origin} blob:`,
    `frame-src ${origin} blob:`,
    "object-src 'none'",
    `base-uri ${origin}`,
    `form-action ${origin}`,
    `frame-ancestors ${origin}`,
  ].join('; ');
}

function secure(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const isolatedSpaceFrame = /^\/api\/repositories\/[^/]+\/space(?:\/|$)/.test(url.pathname);
  const sameOriginFrame = isolatedSpaceFrame
    || (/^\/api\/repositories\/[^/]+\/files\/[^/]+$/.test(url.pathname) && url.searchParams.get('inline') === '1');
  headers.set(
    'content-security-policy',
    isolatedSpaceFrame
      ? isolatedSpaceCsp(url.origin)
      : sameOriginFrame
        ? csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
        : csp,
  );
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups');
  headers.set('cross-origin-resource-policy', isolatedSpaceFrame ? 'cross-origin' : 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', sameOriginFrame ? 'SAMEORIGIN' : 'DENY');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const runtimeEnv = env as Record<string, string | undefined>;

  const publishableKey =
    runtimeEnv?.PUBLIC_CLERK_PUBLISHABLE_KEY ??
    import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey =
    runtimeEnv?.CLERK_SECRET_KEY ?? import.meta.env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return secure(await next(), context.request);
  }

  const response = await withClerk(context, next);
  return secure(response ?? (await next()), context.request);
});
