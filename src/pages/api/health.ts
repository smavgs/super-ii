import type { APIRoute } from 'astro';
import { pingDatabase } from '@/lib/db';
import { authIsConfigured } from '@/lib/site';

export const GET: APIRoute = async ({ locals }) => {
  const database = await pingDatabase(locals);
  const authentication = authIsConfigured(locals) ? 'ok' : 'unconfigured';
  const healthy = database === 'ok' && authentication === 'ok';

  return new Response(
    JSON.stringify({
      status: healthy ? 'ok' : 'degraded',
    }),
    {
      status: healthy ? 200 : 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
};
