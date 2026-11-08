import type { APIRoute } from 'astro';
import { hfFiles } from '@/lib/hf-catalogue';
import { hfRequestListing, hfResponseError } from '@/lib/hf-http';
export const GET: APIRoute = async context => {
  try {
    const item = await hfRequestListing(context,'files');
    const result = await hfFiles(item,context.url.searchParams.get('path') ?? '',context.url.searchParams.get('cursor') ?? '');
    return Response.json(result,{headers:{'cache-control':'private, no-store'}});
  } catch (error) { return hfResponseError(error); }
};
