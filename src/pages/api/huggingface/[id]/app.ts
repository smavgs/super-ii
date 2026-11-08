import type { APIRoute } from 'astro';
import { hfFrameOrigin, hfPublicState, HfSourceError } from '@/lib/hf-catalogue';
import { hfRequestListing, hfResponseError } from '@/lib/hf-http';
export const GET: APIRoute = async context => {
  try {
    const item = await hfRequestListing(context,'app');
    if (item.kind !== 'space') throw new HfSourceError(404,'This listing is not an app.');
    const state = await hfPublicState(item);
    const runtime = state.runtime as {stage?:unknown} | undefined;
    const origin = hfFrameOrigin(state.subdomain);
    if (!origin || !['RUNNING','RUNNING_BUILDING','SLEEPING'].includes(String(runtime?.stage))) throw new HfSourceError(503,'This app is not running on Hugging Face. Please try again later.');
    return Response.json({url:origin,title:item.title},{headers:{'cache-control':'private, no-store'}});
  } catch (error) { return hfResponseError(error); }
};
