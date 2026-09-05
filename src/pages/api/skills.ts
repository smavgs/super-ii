import type { APIRoute } from 'astro';
import { parseSkillsCatalog, SKILLS_SOURCE_URL, type SkillsCatalog } from '@/lib/skills';

const FRESH_SECONDS = 300;
const STALE_SECONDS = 86_400;
const MAX_UPSTREAM_BYTES = 2_000_000;
const CACHE_KEY = new Request('https://superii.site/.internal-cache/make-great-agents-v1');

function publicResponse(body: string, state: 'fresh' | 'hit' | 'stale') {
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': `public, max-age=60, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-superii-skills-cache': state,
    },
  });
}

function unavailable() {
  return Response.json(
    { error: 'skills catalog is temporarily unavailable' },
    {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'retry-after': '60',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

function cacheStorage(): Cache | null {
  try {
    return (caches as CacheStorage & { default: Cache }).default;
  } catch {
    return null;
  }
}

async function readCached(cache: Cache | null): Promise<{ body: string; fetchedAt: number } | null> {
  if (!cache) return null;
  try {
    const response = await cache.match(CACHE_KEY);
    const fetchedAt = Number(response?.headers.get('x-superii-skills-fetched-at'));
    if (!response || !response.ok || !Number.isFinite(fetchedAt)) return null;
    const body = await response.text();
    const parsed = JSON.parse(body) as SkillsCatalog;
    if (parsed.version !== 1 || !Array.isArray(parsed.skills) || !parsed.skills.length) return null;
    return { body, fetchedAt };
  } catch {
    return null;
  }
}

async function fetchCatalog(): Promise<{ body: string; fetchedAt: number } | null> {
  try {
    const response = await fetch(SKILLS_SOURCE_URL, {
      headers: { accept: 'application/json' },
      // Workers deliberately omits redirect: "error". Manual keeps the fixed
      // upstream allowlist from following an unexpected redirect.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const advertisedSize = Number(response.headers.get('content-length'));
    if (!response.ok || (Number.isFinite(advertisedSize) && advertisedSize > MAX_UPSTREAM_BYTES)) return null;
    const raw = await response.text();
    if (raw.length > MAX_UPSTREAM_BYTES) return null;
    const catalog = parseSkillsCatalog(JSON.parse(raw) as unknown);
    if (!catalog) return null;
    return { body: JSON.stringify(catalog), fetchedAt: Date.now() };
  } catch (error) {
    console.error(JSON.stringify({
      message: 'skills catalog refresh failed',
      reason: error instanceof Error ? error.name : 'unknown',
      detail: error instanceof Error ? error.message.slice(0, 240) : undefined,
    }));
    return null;
  }
}

async function storeCached(cache: Cache | null, catalog: { body: string; fetchedAt: number }) {
  if (!cache) return;
  try {
    await cache.put(CACHE_KEY, new Response(catalog.body, {
      headers: {
        'cache-control': `public, max-age=${STALE_SECONDS}`,
        'content-type': 'application/json; charset=utf-8',
        'x-superii-skills-fetched-at': String(catalog.fetchedAt),
      },
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: 'skills catalog cache write failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }));
  }
}

export const GET: APIRoute = async () => {
  const cache = cacheStorage();
  const cached = await readCached(cache);
  if (cached && Date.now() - cached.fetchedAt <= FRESH_SECONDS * 1_000) {
    return publicResponse(cached.body, 'hit');
  }

  const refreshed = await fetchCatalog();
  if (refreshed) {
    await storeCached(cache, refreshed);
    return publicResponse(refreshed.body, 'fresh');
  }

  if (cached && Date.now() - cached.fetchedAt <= STALE_SECONDS * 1_000) {
    return publicResponse(cached.body, 'stale');
  }
  return unavailable();
};
