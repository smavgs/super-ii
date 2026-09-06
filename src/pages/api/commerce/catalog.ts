import type { APIRoute } from 'astro';
import { commerceCatalog } from '@/lib/commerce';
import { commerceCorsHeaders, commerceOptionsResponse } from '@/lib/commerce-http';

export const OPTIONS: APIRoute = async () => commerceOptionsResponse();

export const GET: APIRoute = async ({ request }) => Response.json(
  commerceCatalog(new URL(request.url).origin),
  {
    headers: {
      ...commerceCorsHeaders,
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  },
);
