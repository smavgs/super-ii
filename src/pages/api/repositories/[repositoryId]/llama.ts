import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { managedRepository } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';
import { publishedRevisionId, runtimeJsonResponse } from '@/lib/runtime-repository';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function messagesFrom(value: unknown): Message[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const messages: Message[] = [];
  let totalLength = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const role = 'role' in item ? item.role : undefined;
    const content = 'content' in item ? item.content : undefined;
    if (!['system', 'user', 'assistant'].includes(String(role)) || typeof content !== 'string' || !content.length) return null;
    totalLength += content.length;
    if (content.length > 100_000 || totalLength > 100_000) return null;
    messages.push({ role: role as Message['role'], content });
  }
  return messages;
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'expected JSON' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 120_000) {
    return Response.json({ error: 'request is too large' }, { status: 413 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  if (!profile) return Response.json({ error: 'sign in to use server inference' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'llama_inference', 20, 3600);
  if (rateLimit === 'limited') {
    return Response.json({ error: 'local inference rate limit reached' }, { status: 429, headers: { 'retry-after': '3600' } });
  }
  if (rateLimit === 'unavailable') {
    return Response.json({ error: 'inference safety service unavailable' }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const mode = payload.mode === 'chat' ? 'chat' : payload.mode === 'generate' ? 'generate' : null;
  const maxTokens = finiteNumber(payload.max_tokens, 256, 1, 4096);
  const temperature = finiteNumber(payload.temperature, 0.7, 0, 2);
  const topP = finiteNumber(payload.top_p, 0.95, Number.EPSILON, 1);
  const seed = finiteNumber(payload.seed, -1, -1, 2 ** 31 - 1);
  const modelPath = payload.model_path === undefined || payload.model_path === null
    ? null
    : typeof payload.model_path === 'string' && payload.model_path.length <= 1024
      ? payload.model_path
      : undefined;
  if (!mode || maxTokens === null || temperature === null || topP === null || seed === null || modelPath === undefined) {
    return Response.json({ error: 'invalid generation settings' }, { status: 400 });
  }

  let runtimePayload: Record<string, unknown>;
  if (mode === 'generate') {
    if (typeof payload.prompt !== 'string' || payload.prompt.length < 1 || payload.prompt.length > 100_000) {
      return Response.json({ error: 'prompt must contain 1 to 100000 characters' }, { status: 400 });
    }
    runtimePayload = { model_path: modelPath, prompt: payload.prompt, max_tokens: maxTokens, temperature, top_p: topP, seed };
  } else {
    const messages = messagesFrom(payload.messages);
    if (!messages) return Response.json({ error: 'chat messages are invalid' }, { status: 400 });
    runtimePayload = { model_path: modelPath, messages, max_tokens: maxTokens, temperature, top_p: topP, seed };
  }

  const repositoryId = params.repositoryId ?? '';
  const revisionId = await publishedRevisionId(sql, repositoryId, 'model');
  if (!revisionId) return Response.json({ error: 'model not found' }, { status: 404 });
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${revisionId}/llama/${mode === 'chat' ? 'chat' : 'generate'}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runtimePayload),
    },
  );
  if (!upstream) return Response.json({ error: 'llama.cpp runtime unavailable' }, { status: 503 });
  return runtimeJsonResponse(upstream);
};

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  if (!profile) return Response.json({ error: 'sign in to view runtime status' }, { status: 401 });
  const repositoryId = params.repositoryId ?? '';
  const revisionId = await publishedRevisionId(sql, repositoryId, 'model');
  if (!revisionId) return Response.json({ error: 'model not found' }, { status: 404 });
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${revisionId}/llama/status`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!upstream) return Response.json({ error: 'llama.cpp runtime unavailable' }, { status: 503 });
  return runtimeJsonResponse(upstream);
};

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  let profile;
  try {
    profile = await ensureAuthenticatedProfile(locals, sql);
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  if (!profile) return Response.json({ error: 'sign in to unload a model' }, { status: 401 });
  const repositoryId = params.repositoryId ?? '';
  const managed = await managedRepository(sql, repositoryId, profile.profileId);
  if (!managed) {
    return Response.json({ error: 'repository owner or maintainer access required' }, { status: 403 });
  }
  const revisionId = await publishedRevisionId(sql, repositoryId, 'model');
  if (!revisionId) return Response.json({ error: 'model not found' }, { status: 404 });
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${revisionId}/llama/unload`,
    { method: 'POST', signal: AbortSignal.timeout(30_000) },
  );
  if (!upstream) return Response.json({ error: 'llama.cpp runtime unavailable' }, { status: 503 });
  return runtimeJsonResponse(upstream);
};
