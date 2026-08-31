import type { APIRoute } from 'astro';
import { BRIDGE_CLIENT_ID, BRIDGE_REDIRECT_URI } from '@/lib/bridge';

export const prerender = true;

export const GET: APIRoute = async () => Response.json({
  client_id: BRIDGE_CLIENT_ID,
  client_name: 'Super ii Bridge',
  client_uri: 'https://superii.site/bring-my-work',
  logo_uri: 'https://superii.site/brand/super-ii-logo.png',
  policy_uri: 'https://superii.site/legal/privacy',
  tos_uri: 'https://superii.site/legal/terms',
  redirect_uris: [BRIDGE_REDIRECT_URI],
  response_types: ['code'],
  grant_types: ['authorization_code'],
  token_endpoint_auth_method: 'none',
}, {
  headers: {
    'cache-control': 'public, max-age=3600',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  },
});
