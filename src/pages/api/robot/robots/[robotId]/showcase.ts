import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const headers = { 'cache-control': 'private, no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stages = new Set(['concept','prototype','testing','production','research']);
const kinds = new Set(['software','source','docs','video','cad','model','dataset','app']);

export const PUT: APIRoute = async ({ locals, request, params }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403, headers });
  const robotId = params.robotId ?? '';
  if (!uuidPattern.test(robotId)) return Response.json({ error: 'Robot not found' }, { status: 404, headers });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'Robot database unavailable' }, { status: 503, headers });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401, headers });
  const rate = await consumeRateLimit(locals, request, sql, 'robot.showcase.update', 60, 3600);
  if (rate !== 'allowed') return Response.json({ error: rate === 'limited' ? 'Robot Showcase update limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503, headers });
  const parsed = await readBoundedJsonObject(request, 32_768);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers });
  const stage = typeof parsed.value.project_stage === 'string' ? parsed.value.project_stage : '';
  const softwareSummary = typeof parsed.value.software_summary === 'string' ? parsed.value.software_summary.trim() : '';
  const rawCapabilities = Array.isArray(parsed.value.capabilities) ? parsed.value.capabilities : [];
  const capabilities = [...new Set(rawCapabilities.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
  const rawLinks = Array.isArray(parsed.value.links) ? parsed.value.links : [];
  const links: Array<{ kind: string; label: string; url: string }> = [];
  try {
    if (!stages.has(stage) || softwareSummary.length > 2_000 || capabilities.length > 12 || capabilities.some((value) => value.length > 100) || rawLinks.length > 12) throw new Error('invalid Robot Showcase');
    for (const raw of rawLinks) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Robot link');
      const value = raw as Record<string, unknown>;
      const kind = typeof value.kind === 'string' ? value.kind : '';
      const label = typeof value.label === 'string' ? value.label.trim() : '';
      const rawUrl = typeof value.url === 'string' ? value.url.trim() : '';
      if (!kinds.has(kind) || !label || label.length > 80) throw new Error('invalid Robot link');
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.toString().length > 2_048) throw new Error('invalid Robot link');
      links.push({ kind, label, url: url.toString() });
    }
    const rows = await sql`select app.update_robot_showcase(
      ${robotId}::uuid, ${stage}, ${capabilities}, ${softwareSummary}, ${JSON.stringify(links)}::jsonb
    ) as updated`;
    if (rows[0]?.updated !== true) return Response.json({ error: 'Robot not found or permission denied' }, { status: 403, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Robot Showcase is invalid' }, { status: 422, headers });
  }
};
