import { connectionReturnPath } from './connection-policy';
import { stripLocalePrefix } from './i18n';

const safeExactRedirects = new Set([
  '/account',
  '/account#agent-starter',
  '/account?welcome=agent-starter#agent-starter',
  '/account#ai-worker',
  '/account?welcome=ai-worker#ai-worker',
  '/account#agents',
  '/account#commerce',
  '/account#profile',
  '/account#repositories',
  '/bring-my-work',
  '/frontier-ai',
  '/frontier-ai#setup',
  '/new',
  '/new?kind=model',
  '/new?kind=dataset',
  '/new?kind=space',
  '/organizations/new',
  '/pricing',
  '/skills',
]);

function normalizeLocalRedirect(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 2048) return null;
  try {
    const url = new URL(value, 'https://superii.site');
    if (url.origin !== 'https://superii.site' || url.username || url.password) return null;
    const pathname = stripLocalePrefix(url.pathname);
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function isSafeReportRedirect(value: string): boolean {
  const url = new URL(value, 'https://superii.site');
  return /^\/transparent\/[a-z0-9][a-z0-9-]{0,127}$/i.test(url.pathname)
    && !url.search
    && !url.hash;
}

export function safeAuthRedirect(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const normalized = normalizeLocalRedirect(value);
  if (!normalized) return fallback;
  return safeExactRedirects.has(normalized)
    || connectionReturnPath(normalized)
    || isSafeReportRedirect(normalized)
    ? normalized
    : fallback;
}
