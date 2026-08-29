import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { proxyPublishedSpace } from '@/lib/space-proxy';

const proxy: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  return proxyPublishedSpace(locals, request, sql, params.repositoryId ?? '', '');
};

export const GET = proxy;
export const HEAD = proxy;
