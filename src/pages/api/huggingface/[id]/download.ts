import type { APIRoute } from 'astro';
import { hfFile } from '@/lib/hf-catalogue';
import { streamHfFile } from '@/lib/hf-download';
import { hfRequestListing, hfResponseError } from '@/lib/hf-http';
const serve: APIRoute = async context => {
  try {
    const item = await hfRequestListing(context,'download');
    const file = await hfFile(item,context.url.searchParams.get('path') ?? '');
    return await streamHfFile(context.request,item,file);
  } catch (error) { return hfResponseError(error); }
};
export const GET = serve;
export const HEAD = serve;
