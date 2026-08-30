import type { APIRoute } from 'astro';
import { systemStateMarkdown } from '@/lib/system-state';

export const GET: APIRoute = () => new Response(systemStateMarkdown, {
  headers: {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
  },
});
