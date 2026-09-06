import type { APIRoute } from 'astro';
import { commerceCatalog } from '@/lib/commerce';

export const GET: APIRoute = async ({ request }) => Response.json(
  commerceCatalog(new URL(request.url).origin),
  {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300, s-maxage=3600',
      'x-content-type-options': 'nosniff',
    },
  },
);
