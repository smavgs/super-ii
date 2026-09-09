import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { negotiatedRepositoryResponse } from '@/lib/agent-resources';
import { getPublicRepository } from '@/lib/repository';
import type { RepositoryKind } from '@/lib/catalog';
import { getPublicPaper, paperDocument, paperMarkdown } from '@/lib/papers';
import {
  isLocalizablePath,
  localeCookie,
  localeFromPathname,
  localizedPath,
  localizedUrl,
  stripLocalePrefix,
  translateKnown,
  translateTextChunk,
  type SiteLocale,
} from '@/lib/i18n';

const withClerk = clerkMiddleware(async (_auth, context, next) => {
  const render = next as unknown as (rewrite?: URL) => Promise<Response>;
  const response = await render(context.locals.localizedRewrite);
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

function textHandler(locale: SiteLocale, isExcluded: () => boolean) {
  let buffer = '';
  const decode = (value: string) => {
    let result = value;
    for (let pass = 0; pass < 2; pass += 1) {
      result = result
        .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
        .replace(/&#x([\da-f]+);/gi, (_match, number) => String.fromCodePoint(Number.parseInt(number, 16)))
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&');
    }
    return result;
  };
  const escape = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return {
    text(chunk: Text) {
      if (isExcluded()) return;
      buffer += chunk.text;
      chunk.remove();
      if (chunk.lastInTextNode) {
        chunk.replace(escape(translateTextChunk(decode(buffer), locale)), { html: true });
        buffer = '';
      }
    },
  };
}

function pageRequest(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function redirectResponse(url: URL, clearLocale = false): Response {
  const headers = new Headers({ location: url.toString() });
  if (clearLocale) {
    headers.append('set-cookie', `${localeCookie}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
  }
  return new Response(null, { status: 303, headers });
}

function localizeAnchor(element: Element, requestUrl: URL, locale: SiteLocale): void {
  const language = element.getAttribute('data-language-switch');
  if (language) {
    const target = new URL(requestUrl);
    target.searchParams.delete('language');
    if (locale === 'ru') {
      target.pathname = stripLocalePrefix(target.pathname);
      target.searchParams.set('language', 'en');
      element.setAttribute('href', `${target.pathname}${target.search}${target.hash}`);
      element.setInnerContent('en');
      element.setAttribute('lang', 'en');
      element.setAttribute('hreflang', 'en');
      element.setAttribute('aria-label', 'English');
    } else {
      target.pathname = localizedPath(target.pathname, 'ru');
      element.setAttribute('href', `${target.pathname}${target.search}${target.hash}`);
      element.setInnerContent('ru');
      element.setAttribute('lang', 'ru');
      element.setAttribute('hreflang', 'ru');
      element.setAttribute('aria-label', 'Русский');
    }
    return;
  }
  if (locale !== 'ru') return;
  const raw = element.getAttribute('href');
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
  let target: URL;
  try {
    target = new URL(raw, requestUrl.origin);
  } catch {
    return;
  }
  if (target.origin !== requestUrl.origin || !isLocalizablePath(target.pathname)) return;
  const wasAbsolute = /^https?:\/\//i.test(raw);
  target.pathname = localizedPath(target.pathname, 'ru');
  element.setAttribute('href', wasAbsolute ? target.toString() : `${target.pathname}${target.search}${target.hash}`);
}

function localizeFormAction(element: Element, requestUrl: URL, locale: SiteLocale): void {
  if (locale !== 'ru') return;
  const raw = element.getAttribute('action');
  if (!raw || raw.startsWith('//')) return;
  let target: URL;
  try {
    target = new URL(raw, requestUrl.origin);
  } catch {
    return;
  }
  if (target.origin !== requestUrl.origin || !isLocalizablePath(target.pathname)) return;
  target.pathname = localizedPath(target.pathname, 'ru');
  element.setAttribute('action', `${target.pathname}${target.search}${target.hash}`);
}

function secure(response: Response, request: Request, locale: SiteLocale = localeFromPathname(new URL(request.url).pathname)): Response {
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
  if (transformHtml) {
    headers.set('content-language', locale);
    const vary = new Set((headers.get('vary') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    vary.add('Cookie');
    headers.set('vary', [...vary].join(', '));
    if (locale === 'ru') {
      headers.append('set-cookie', `${localeCookie}=ru; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
    }
  }
  const secured = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (!nonce) return secured;
  const requestUrl = new URL(request.url);
  const englishUrl = new URL(stripLocalePrefix(requestUrl.pathname), 'https://superii.site');
  const russianUrl = localizedUrl(englishUrl, 'ru');
  let excludedDepth = 0;
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
  ]);
  let rewriter = new HTMLRewriter();
  for (const selector of ['script', 'style', 'pre', 'code', 'samp', 'kbd', 'textarea', 'template', 'svg', '[data-no-translate]']) {
    rewriter = rewriter.on(selector, {
      element(element) {
        if (voidElements.has(element.tagName.toLowerCase())) return;
        excludedDepth += 1;
        element.onEndTag(() => { excludedDepth = Math.max(0, excludedDepth - 1); });
      },
    });
  }
  rewriter = rewriter
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
    .on('html', {
      element(element) {
        element.setAttribute('lang', locale);
        element.setAttribute('data-locale', locale);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        const canonical = locale === 'ru' ? russianUrl : englishUrl;
        element.setAttribute('href', canonical.toString());
        element.after(
          `<link rel="alternate" hreflang="en" href="${englishUrl.toString()}"><link rel="alternate" hreflang="ru" href="${russianUrl.toString()}"><link rel="alternate" hreflang="x-default" href="${englishUrl.toString()}">`,
          { html: true },
        );
      },
    })
    .on('meta[property="og:locale"]', {
      element(element) {
        element.setAttribute('content', locale === 'ru' ? 'ru_RU' : 'en_US');
        element.after(`<meta property="og:locale:alternate" content="${locale === 'ru' ? 'en_US' : 'ru_RU'}">`, { html: true });
      },
    })
    .on('meta[property="og:url"]', {
      element(element) {
        element.setAttribute('content', (locale === 'ru' ? russianUrl : englishUrl).toString());
      },
    })
    .on('meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[property="og:image:alt"], meta[name="twitter:title"], meta[name="twitter:description"], meta[name="twitter:image:alt"]', {
      element(element) {
        const value = element.getAttribute('content');
        if (value) element.setAttribute('content', translateKnown(value, locale));
      },
    })
    .on('title', textHandler(locale, () => false))
    .on('body', textHandler(locale, () => excludedDepth > 0))
    .on('a[href]', {
      element(element) {
        localizeAnchor(element, requestUrl, locale);
      },
    })
    .on('form[action]', {
      element(element) {
        localizeFormAction(element, requestUrl, locale);
      },
    });
  for (const attribute of ['placeholder', 'aria-label', 'title', 'alt']) {
    rewriter = rewriter.on(`*[${attribute}]`, {
      element(element) {
        if (element.hasAttribute('data-no-translate')) return;
        const value = element.getAttribute(attribute);
        if (value) element.setAttribute(attribute, translateKnown(value, locale));
      },
    });
  }
  return rewriter
    .transform(secured);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const requestedLocale = localeFromPathname(context.url.pathname);
  const languageChoice = context.url.searchParams.get('language');
  if (languageChoice === 'en' && pageRequest(context.request)) {
    const clean = new URL(context.url);
    clean.pathname = stripLocalePrefix(clean.pathname);
    clean.searchParams.delete('language');
    return secure(redirectResponse(clean, true), context.request, 'en');
  }
  if (
    requestedLocale === 'en'
    && cookieValue(context.request, localeCookie) === 'ru'
    && pageRequest(context.request)
    && isLocalizablePath(context.url.pathname)
  ) {
    const localized = localizedUrl(context.url, 'ru');
    return secure(redirectResponse(localized), context.request, 'en');
  }

  context.locals.locale = requestedLocale;
  const routePath = stripLocalePrefix(context.url.pathname);
  if (requestedLocale === 'ru' && isLocalizablePath(context.url.pathname)) {
    const rewrite = new URL(context.url);
    rewrite.pathname = routePath;
    context.locals.localizedRewrite = rewrite;
  }

  if (context.request.method === 'GET') {
    const accept = context.request.headers.get('accept')?.toLowerCase() ?? '';
    const machineRead = (
      (accept.includes('application/json') || accept.includes('text/markdown'))
      && !accept.includes('text/html')
    );
    const match = routePath.match(/^\/(models|datasets|spaces)\/([^/]+)\/([^/]+)$/);
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
    const paperMatch = routePath.match(/^\/papers\/([^/]+)\/([^/]+)$/);
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
    return secure(await next(context.locals.localizedRewrite), context.request, requestedLocale);
  }

  const response = await withClerk(context, next);
  return secure(response ?? (await next(context.locals.localizedRewrite)), context.request, requestedLocale);
});
