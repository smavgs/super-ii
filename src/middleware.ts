import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { negotiatedRepositoryResponse } from '@/lib/agent-resources';
import { getPublicRepository } from '@/lib/repository';
import type { RepositoryKind } from '@/lib/catalog';
import { getPublicPaper, paperDocument, paperMarkdown } from '@/lib/papers';

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
  if (context.request.method === 'GET') {
    const accept = context.request.headers.get('accept')?.toLowerCase() ?? '';
    const machineRead = (
      (accept.includes('application/json') || accept.includes('text/markdown'))
      && !accept.includes('text/html')
    );
    const match = context.url.pathname.match(/^\/(models|datasets|spaces)\/([^/]+)\/([^/]+)$/);
    if (machineRead && match) {
      const kindMap: Record<string, RepositoryKind> = {
        models: 'model',
        datasets: 'dataset',
        spaces: 'space',
      };
      let owner = '';
      let slug = '';
      try {
        owner = decodeURIComponent(match[2]);
        slug = decodeURIComponent(match[3]);
      } catch {
        return secure(Response.json({ error: 'invalid repository path' }, { status: 400 }), context.request);
      }
      const result = await getPublicRepository(context.locals, kindMap[match[1]], owner, slug);
      if (!result.repository) {
        return secure(Response.json(
          { error: result.state === 'error' ? 'repository service unavailable' : 'repository not found' },
          { status: result.state === 'error' ? 503 : 404 },
        ), context.request);
      }
      const response = negotiatedRepositoryResponse(result.repository, context.request);
      if (response) return secure(response, context.request);
    }
    const paperMatch = context.url.pathname.match(/^\/papers\/([^/]+)\/([^/]+)$/);
    if (machineRead && paperMatch) {
      let owner = '';
      let slug = '';
      try {
        owner = decodeURIComponent(paperMatch[1]);
        slug = decodeURIComponent(paperMatch[2]);
      } catch {
        return secure(Response.json({ error: 'invalid paper path' }, { status: 400 }), context.request);
      }
      const result = await getPublicPaper(context.locals, owner, slug);
      if (!result.paper) {
        return secure(Response.json(
          { error: result.state === 'error' ? 'paper service unavailable' : 'paper not found' },
          { status: result.state === 'error' ? 503 : 404 },
        ), context.request);
      }
      const origin = context.url.origin;
      const response = accept.includes('application/json')
        ? Response.json(paperDocument(result.paper, origin))
        : new Response(paperMarkdown(result.paper, origin), {
            headers: { 'content-type': 'text/markdown; charset=utf-8' },
          });
      return secure(response, context.request);
    }
  }

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
