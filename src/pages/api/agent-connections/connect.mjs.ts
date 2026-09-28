import type { APIRoute } from 'astro';
import connector from '../../../../public/agents/connect.mjs?raw';

export const prerender = true;
export const GET: APIRoute = () => new Response(connector, {
  headers: {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
  },
});
