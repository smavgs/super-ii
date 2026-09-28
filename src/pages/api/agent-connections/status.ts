import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { connectionJson, inspectConnection } from '@/lib/agent-connections';
export const GET: APIRoute = async ({ locals, request, url }) => {
  const resource = url.searchParams.get('resource');
  if (resource !== 'work' && resource !== 'social')
    return connectionJson({ error: 'invalid_resource' }, 400);
  const sql = sqlClient(locals);
  if (!sql) return connectionJson({ error: 'temporarily_unavailable' }, 503);
  const rate = await consumeRateLimit(locals, request, sql, 'connections.status', 300, 3600);
  if (rate !== 'allowed')
    return connectionJson(
      { error: rate === 'limited' ? 'rate_limited' : 'temporarily_unavailable' },
      rate === 'limited' ? 429 : 503,
    );
  try {
    const result = await inspectConnection(sql, request, resource);
    return connectionJson(
      {
        ...result,
        renewal: 'Human approval is required after expiry or for broader access.',
        reconnect_uri: `${url.origin}/account#agents`,
      },
      result.status === 'invalid_token' ? 401 : 200,
    );
  } catch {
    return connectionJson({ error: 'temporarily_unavailable' }, 503);
  }
};
