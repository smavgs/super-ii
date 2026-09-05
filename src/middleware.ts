import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { negotiatedRepositoryResponse } from '@/lib/agent-resources';
import { getPublicRepository } from '@/lib/repository';
import type { RepositoryKind } from '@/lib/catalog';
import { getPublicPaper, paperDocument, paperMarkdown } from '@/lib/papers';

const withClerk = clerkMiddleware(async (_auth, _context, next) => {
  const response = await next();
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
});

const clerkFrontendApi = 'https://clerk.superii.site';

function responseNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function contentSecurityPolicy(nonce: string | null, allowSameOriginFrame = false): string {
  const scriptSources = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []),
    "'wasm-unsafe-eval'",
    clerkFrontendApi,
    'https://challenges.cloudflare.com',
    'https://*.protect.clerk.com',
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "script-src-attr 'none'",
    `connect-src 'self' ${clerkFrontendApi} https://clerk-telemetry.com https://*.clerk-telemetry.com https://challenges.cloudflare.com https://*.protect.clerk.com:*`,
    "img-src 'self' data: blob: https://img.clerk.com https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    `frame-src 'self' ${clerkFrontendApi} https://challenges.cloudflare.com https://*.protect.clerk.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors '${allowSameOriginFrame ? 'self' : 'none'}'`,
    'upgrade-insecure-requests',
  ].join('; ');
}

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
  const inlineMediaFrame = /^\/api\/repositories\/[^/]+\/files\/[^/]+$/.test(url.pathname)
    && url.searchParams.get('inline') === '1';
  const sameOriginFrame = isolatedSpaceFrame || inlineMediaFrame;
  const contentType = headers.get('content-type')?.toLowerCase() ?? '';
  const transformHtml = !isolatedSpaceFrame
    && !inlineMediaFrame
    && request.method !== 'HEAD'
    && response.body !== null
    && contentType.includes('text/html');
  const nonce = transformHtml ? responseNonce() : null;
  const strictPolicy = contentSecurityPolicy(nonce);
  headers.set('content-security-policy', isolatedSpaceFrame
    ? isolatedSpaceCsp(url.origin)
    : inlineMediaFrame
      ? "default-src 'none'; frame-ancestors 'self'"
      : strictPolicy);
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups');
  headers.set('cross-origin-resource-policy', isolatedSpaceFrame ? 'cross-origin' : 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', sameOriginFrame ? 'SAMEORIGIN' : 'DENY');
  const secured = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (!nonce) return secured;
  return new HTMLRewriter()
    .on('link[rel="preload"][as="script"]', {
      element(element) {
        const href = element.getAttribute('href') ?? '';
        if (href.includes('/npm/@clerk/ui@')) element.remove();
      },
    })
    .on('script', {
      element(element) {
        element.setAttribute('nonce', nonce);
      },
    })
    .transform(secured);
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
