import type { APIRoute } from 'astro';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ensureAuthenticatedProfile, sameOrigin, type AuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import {
  activeAssistantPlan,
  assistantPlanEntitlements,
  type AssistantPlan,
} from '@/lib/assistant-plan';
import {
  addAssistantMemory,
  assistantMemoryState,
  deleteAssistantMemory,
  parseAssistantId,
  setAssistantMemoryEnabled,
  updateAssistantMemory,
} from '@/lib/assistant-store';
import { consumeIdentityRateLimit } from '@/lib/rate-limit';

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store, private', pragma: 'no-cache', vary: 'Cookie' },
  });
}

type AssistantMemoryContext =
  | { response: Response }
  | {
      sql: NeonQueryFunction<false, false>;
      profile: AuthenticatedProfile;
      plan: AssistantPlan;
    };

async function authorized(
  locals: App.Locals,
  request: Request,
  mutation: boolean,
): Promise<AssistantMemoryContext> {
  if (mutation && !sameOrigin(request)) return { response: json({ error: 'invalid origin' }, 403) };
  const sql = sqlClient(locals);
  if (!sql) return { response: json({ error: 'chat memory unavailable' }, 503) };
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return { response: json({ error: 'authentication required' }, 401) };
    const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, mutation ? 'assistant.memory.write' : 'assistant.memory.read', mutation ? 60 : 120, 3600);
    if (rate !== 'allowed') return { response: json({ error: rate === 'limited' ? 'chat memory request limit reached' : 'chat memory unavailable' }, rate === 'limited' ? 429 : 503) };
    const plan = await activeAssistantPlan(sql, profile);
    return { sql, profile, plan };
  } catch {
    return { response: json({ error: 'authentication service unavailable' }, 503) };
  }
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 5_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ locals, request }) => {
  const state = await authorized(locals, request, false);
  if ('response' in state) return state.response;
  try {
    const memory = await assistantMemoryState(state.sql, state.profile.profileId);
    return json({
      plan: state.plan,
      available: assistantPlanEntitlements[state.plan].selectableMemory,
      ...memory,
    });
  } catch {
    return json({ error: 'chat memory unavailable' }, 503);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const state = await authorized(locals, request, true);
  if ('response' in state) return state.response;
  if (!assistantPlanEntitlements[state.plan].selectableMemory) {
    return json({ error: 'chat memory requires Pro, Team, or Enterprise', plan: state.plan }, 403);
  }
  const input = await body(request);
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  const content = typeof input?.content === 'string' ? input.content.trim() : '';
  const sourceThreadProvided = input !== null
    && input.source_thread_id !== undefined
    && input.source_thread_id !== null;
  const sourceThreadId = input?.source_thread_id === undefined || input.source_thread_id === null
    ? null
    : parseAssistantId(input.source_thread_id);
  if (!label || label.length > 120 || !content || content.length > 2_000 || (sourceThreadProvided && !sourceThreadId)) {
    return json({ error: 'invalid chat memory' }, 400);
  }
  try {
    const memoryId = await addAssistantMemory(state.sql, state.profile.profileId, state.plan, label, content, sourceThreadId);
    return memoryId ? json({ created: true, memory_id: memoryId }, 201) : json({ error: 'chat memory could not be saved' }, 503);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return json({ error: detail.includes('assistant_storage_limit_reached') ? 'included storage limit reached' : 'chat memory could not be saved' }, detail.includes('assistant_storage_limit_reached') ? 409 : 503);
  }
};

export const PATCH: APIRoute = async ({ locals, request }) => {
  const state = await authorized(locals, request, true);
  if ('response' in state) return state.response;
  const input = await body(request);
  if (!input) return json({ error: 'invalid chat memory update' }, 400);
  if (typeof input.enabled === 'boolean') {
    if (input.enabled && !assistantPlanEntitlements[state.plan].selectableMemory) {
      return json({ error: 'chat memory requires Pro, Team, or Enterprise', plan: state.plan }, 403);
    }
    try {
      const enabled = await setAssistantMemoryEnabled(state.sql, state.profile.profileId, input.enabled);
      return json({ updated: true, enabled });
    } catch {
      return json({ error: 'chat memory preference could not be updated' }, 503);
    }
  }
  if (!assistantPlanEntitlements[state.plan].selectableMemory) {
    return json({ error: 'chat memory requires Pro, Team, or Enterprise', plan: state.plan }, 403);
  }
  const memoryId = parseAssistantId(input.id);
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!memoryId || !label || label.length > 120 || !content || content.length > 2_000) {
    return json({ error: 'invalid chat memory update' }, 400);
  }
  try {
    const updated = await updateAssistantMemory(state.sql, state.profile.profileId, state.plan, memoryId, label, content);
    return updated ? json({ updated: true }) : json({ error: 'chat memory not found' }, 404);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return json({ error: detail.includes('assistant_storage_limit_reached') ? 'included storage limit reached' : 'chat memory could not be updated' }, detail.includes('assistant_storage_limit_reached') ? 409 : 503);
  }
};

export const DELETE: APIRoute = async ({ locals, request, url }) => {
  const state = await authorized(locals, request, true);
  if ('response' in state) return state.response;
  const rawId = url.searchParams.get('id');
  const memoryId = rawId ? parseAssistantId(rawId) : null;
  if (rawId && !memoryId) return json({ error: 'invalid chat memory' }, 400);
  try {
    const deleted = await deleteAssistantMemory(state.sql, state.profile.profileId, memoryId);
    return json({ deleted: true, deleted_count: deleted });
  } catch {
    return json({ error: 'chat memory could not be deleted' }, 503);
  }
};
