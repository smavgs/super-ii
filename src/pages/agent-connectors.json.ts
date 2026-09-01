import type { APIRoute } from 'astro';
import { agentConnectorRegistry } from '@/lib/agent-connectors';

export const prerender = true;

export const GET: APIRoute = async () => Response.json(agentConnectorRegistry, {
  headers: {
    'cache-control': 'public, max-age=300, s-maxage=3600',
    'x-content-type-options': 'nosniff',
  },
});
