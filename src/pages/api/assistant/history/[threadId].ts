import type { APIRoute } from 'astro';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ensureAuthenticatedProfile, sameOrigin, type AuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import {
  deleteAssistantThread,
  getAssistantThread,
  parseAssistantId,
  updateAssistantThread,
} from '@/lib/assistant-store';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store, private', pragma: 'no-cache', vary: 'Cookie' },
  });
}

type AssistantRequestContext =
  | { response: Response }
  | { sql: NeonQueryFunction<false, false>; profile: AuthenticatedProfile };

async function context(
  locals: App.Locals,
  request: Request,
  mutation: boolean,
): Promise<AssistantRequestContext> {
  if (mutation && !sameOrigin(request)) return { response: json({ error: 'invalid origin' }, 403) };
  const sql = sqlClient(locals);
  if (!sql) return { response: json({ error: 'chat history unavailable' }, 503) };
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return { response: json({ error: 'authentication required' }, 401) };
    const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, mutation ? 'assistant.history.write' : 'assistant.history.read', mutation ? 60 : 120, 3600);
    if (rate !== 'allowed') return { response: json({ error: rate === 'limited' ? 'chat history request limit reached' : 'chat history unavailable' }, rate === 'limited' ? 429 : 503) };
    return { sql, profile };
  } catch {
    return { response: json({ error: 'authentication service unavailable' }, 503) };
  }
}

export const GET: APIRoute = async ({ locals, request, params }) => {
  const threadId = parseAssistantId(params.threadId);
  if (!threadId) return json({ error: 'invalid assistant thread' }, 400);
  const state = await context(locals, request, false);
  if ('response' in state) return state.response;
  try {
    const thread = await getAssistantThread(state.sql, state.profile.profileId, threadId);
    return thread ? json({ thread }) : json({ error: 'assistant thread not found' }, 404);
  } catch {
    return json({ error: 'chat history unavailable' }, 503);
  }
};

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  const threadId = parseAssistantId(params.threadId);
  if (!threadId) return json({ error: 'invalid assistant thread' }, 400);
  const state = await context(locals, request, true);
  if ('response' in state) return state.response;
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 2_000) return json({ error: 'invalid assistant thread update' }, 400);
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { return json({ error: 'invalid assistant thread update' }, 400); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'invalid assistant thread update' }, 400);
  const input = body as Record<string, unknown>;
  const status = input.status === 'archived' ? 'archived' : input.status === 'recent' ? 'recent' : null;
  const projectLabelTypeValid = input.project_label === null
    || input.project_label === undefined
    || typeof input.project_label === 'string';
  const projectLabel = input.project_label === null || input.project_label === undefined
    ? null
    : typeof input.project_label === 'string' ? input.project_label.trim() : null;
  if (!status || !projectLabelTypeValid || (projectLabel !== null && projectLabel.length > 120)) {
    return json({ error: 'invalid assistant thread update' }, 400);
  }
  try {
    const changed = await updateAssistantThread(state.sql, state.profile.profileId, threadId, status, projectLabel);
    return changed ? json({ updated: true }) : json({ error: 'assistant thread not found' }, 404);
  } catch {
    return json({ error: 'assistant thread could not be updated' }, 503);
  }
};

export const DELETE: APIRoute = async ({ locals, request, params }) => {
  const threadId = parseAssistantId(params.threadId);
  if (!threadId) return json({ error: 'invalid assistant thread' }, 400);
  const state = await context(locals, request, true);
  if ('response' in state) return state.response;
  try {
    const deleted = await deleteAssistantThread(state.sql, state.profile.profileId, threadId);
    return deleted ? json({ deleted: true }) : json({ error: 'assistant thread not found' }, 404);
  } catch {
    return json({ error: 'assistant thread could not be deleted' }, 503);
  }
};
