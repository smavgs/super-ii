import type { APIRoute } from 'astro';
import { oauthMetadata } from '@/lib/connection-policy';
export const GET: APIRoute = ({ url }) => Response.json(oauthMetadata(url.origin),{headers:{'cache-control':'public, max-age=300','access-control-allow-origin':'*'}});
