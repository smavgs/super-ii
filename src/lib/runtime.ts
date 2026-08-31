import { runtimeValue } from './db';

export function runtimeIsConfigured(locals: App.Locals): boolean {
  return Boolean(runtimeValue(locals, 'RUNTIME_URL') && runtimeValue(locals, 'RUNTIME_TOKEN'));
}

export type RuntimeReadiness = {
  state: 'ready' | 'blocked' | 'unconfigured' | 'error';
  database: boolean;
  storage: boolean;
  transfer_service: boolean;
  scanners: Record<string, boolean>;
  publishing_enabled: boolean;
};

export async function pingRuntime(locals: App.Locals): Promise<RuntimeReadiness> {
  if (!runtimeIsConfigured(locals)) {
    return { state: 'unconfigured', database: false, storage: false, transfer_service: false, scanners: {}, publishing_enabled: false };
  }
  try {
    const response = await runtimeFetch(locals, '/ready', { signal: AbortSignal.timeout(2500) });
    if (!response?.ok) {
      console.warn('Super ii runtime readiness returned a non-success status', {
        status: response?.status ?? null,
      });
      throw new Error('runtime readiness failed');
    }
    const payload = await response.json() as Record<string, unknown>;
    const scannerPayload = payload.required_scanners ?? payload.scanners;
    const scanners = typeof scannerPayload === 'object' && scannerPayload
      ? Object.fromEntries(Object.entries(scannerPayload).map(([name, value]) => [name, value === true]))
      : {};
    const publishing = payload.publishing_enabled === true;
    return {
      state: publishing ? 'ready' : 'blocked',
      database: payload.database === true,
      storage: payload.storage === true,
      transfer_service: payload.transfer_service === true,
      scanners,
      publishing_enabled: publishing,
    };
  } catch (error) {
    console.warn('Super ii runtime readiness request failed', {
      kind: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown failure',
    });
    return { state: 'error', database: false, storage: false, transfer_service: false, scanners: {}, publishing_enabled: false };
  }
}

export async function runtimeFetch(
  locals: App.Locals,
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const rawBase = runtimeValue(locals, 'RUNTIME_URL');
  const token = runtimeValue(locals, 'RUNTIME_TOKEN');
  if (!rawBase || !token) return null;

  const base = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !local) {
    throw new Error('Super ii Runtime requires HTTPS outside local development');
  }
  const target = new URL(path.replace(/^\//, ''), base);
  if (target.origin !== base.origin) throw new Error('invalid runtime path');

  const headers = new Headers(init.headers);
  headers.set('x-superii-runtime-token', token);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  // Cloudflare Workers does not implement Fetch's `error` redirect mode.
  // `manual` preserves the fail-closed boundary: callers receive the 3xx
  // response and never send the runtime credential to a redirected origin.
  return fetch(target, { ...init, headers, redirect: init.redirect ?? 'manual' });
}

export function proxiedFileResponse(upstream: Response, immutable = true): Response {
  const headers = new Headers();
  for (const name of [
    'accept-ranges',
    'content-disposition',
    'content-length',
    'content-range',
    'content-security-policy',
    'content-type',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
