import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  try {
    const keys = await sql`select id, public_key, policy_sha256, enabled from app.publication_keys`;
    return Response.json({ algorithm: 'Ed25519', keys }, {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch { return Response.json({ error: 'publication keys unavailable' }, { status: 503 }); }
};
