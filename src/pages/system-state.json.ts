import type { APIRoute } from 'astro';
import { systemState } from '@/lib/system-state';

export const GET: APIRoute = () => Response.json(systemState, {
  headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' },
});
