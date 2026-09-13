import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { activeAssistantPlan, assistantPlanEntitlements } from '@/lib/assistant-plan';
import { listAssistantThreads } from '@/lib/assistant-store';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store, private', pragma: 'no-cache', vary: 'Cookie' },
  });
}

export const GET: APIRoute = async ({ locals, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return json({ error: 'chat history unavailable' }, 503);
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return json({ error: 'authentication service unavailable' }, 503);
  }
  if (!profile) return json({ error: 'authentication required' }, 401);
  const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, 'assistant.history.read', 120, 3600);
  if (rate !== 'allowed') return json({ error: rate === 'limited' ? 'chat history request limit reached' : 'chat history unavailable' }, rate === 'limited' ? 429 : 503);
  const requestedStatus = url.searchParams.get('status');
  const status = requestedStatus === 'archived' || requestedStatus === 'all' ? requestedStatus : 'recent';
  const query = url.searchParams.get('q')?.trim().slice(0, 200) || null;
  try {
    const plan = await activeAssistantPlan(sql, profile);
    if (query && !assistantPlanEntitlements[plan].searchableHistory) {
      return json({ error: 'searchable chat history requires Pro, Team, or Enterprise', plan }, 403);
    }
    const threads = await listAssistantThreads(sql, profile.profileId, status, query);
    return json({
      plan,
      persistent_history: assistantPlanEntitlements[plan].persistentHistory,
      searchable_history: assistantPlanEntitlements[plan].searchableHistory,
      threads,
    });
  } catch (error) {
    console.error(JSON.stringify({ message: 'assistant history read failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return json({ error: 'chat history unavailable' }, 503);
  }
};
