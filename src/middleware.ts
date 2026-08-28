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
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', csp);
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
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
    return secure(await next());
  }

  const response = await withClerk(context, next);
  return secure(response ?? (await next()));
});
