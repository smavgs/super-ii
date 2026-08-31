import type { APIRoute } from 'astro';
import { publicRuntimeRegistry } from '@/lib/use-model';

export const GET: APIRoute = () => Response.json(publicRuntimeRegistry(), {
  headers: {
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    'x-content-type-options': 'nosniff',
  },
});
