import type { APIRoute } from 'astro';
import { protectedMetadata } from '@/lib/connection-policy';
export const GET: APIRoute = ({ url,params }) => ['work','social'].includes(params.resource??'')
  ? Response.json(protectedMetadata(url.origin,params.resource as 'work'|'social'),{headers:{'cache-control':'public, max-age=300','access-control-allow-origin':'*'}})
  : Response.json({error:'not_found'},{status:404});
