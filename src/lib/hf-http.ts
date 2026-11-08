import type { APIContext } from 'astro';
import { sqlClient } from './db';
import { consumeRateLimit } from './rate-limit';
import { getHfListing, HfSourceError, validHfId } from './hf-catalogue';

export const hfResponseError = (error: unknown) => Response.json({error:error instanceof HfSourceError ? error.message : 'Hugging Face is temporarily unavailable. Please retry.'},
  {status:error instanceof HfSourceError ? error.status : 502,headers:{'cache-control':'private, no-store'}});
export async function hfRequestListing(context: APIContext, operation: string) {
  if (!validHfId(context.params.id ?? '')) throw new HfSourceError(400,'Invalid listing.');
  const sql = sqlClient(context.locals);
  if (!sql) throw new HfSourceError(503,'Source listings are temporarily unavailable.');
  const item = await getHfListing(sql,context.params.id!);
  if (!item) throw new HfSourceError(404,'This public listing is unavailable.');
  const rate = await consumeRateLimit(context.locals,context.request,sql,`huggingface.${operation}`,240,3600);
  if (rate !== 'allowed') throw new HfSourceError(rate === 'limited' ? 429 : 503,'Please try again later.');
  return item;
}
