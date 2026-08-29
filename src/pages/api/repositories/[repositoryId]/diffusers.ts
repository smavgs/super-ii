import type { APIRoute } from 'astro';
import { signArtifactTicket } from '@/lib/artifact-ticket';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { runtimeValue, sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';
import { publishedRevisionId } from '@/lib/runtime-repository';

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'expected JSON' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 12_000) {
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
  if (!profile) return Response.json({ error: 'sign in to use image generation' }, { status: 401 });
  const rateLimit = await consumeRateLimit(locals, request, sql, 'diffusers_inference', 10, 3600);
  if (rateLimit === 'limited') {
    return Response.json({ error: 'image generation rate limit reached' }, { status: 429, headers: { 'retry-after': '3600' } });
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
  const prompt = payload.prompt;
  const negativePrompt = payload.negative_prompt;
  const steps = finiteNumber(payload.steps, 30, 1, 100);
  const guidanceScale = finiteNumber(payload.guidance_scale, 7.5, 0, 30);
  const width = finiteNumber(payload.width, 512, 128, 2048);
  const height = finiteNumber(payload.height, 512, 128, 2048);
  const seed = finiteNumber(payload.seed, 0, 0, 2 ** 32 - 1);
  if (
    typeof prompt !== 'string'
    || prompt.length < 1
    || prompt.length > 5000
    || (negativePrompt !== undefined && negativePrompt !== null && (typeof negativePrompt !== 'string' || negativePrompt.length > 5000))
    || steps === null
    || guidanceScale === null
    || width === null
    || height === null
    || seed === null
    || !Number.isInteger(steps)
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || !Number.isInteger(seed)
    || width % 8 !== 0
    || height % 8 !== 0
  ) {
    return Response.json({ error: 'invalid image-generation settings' }, { status: 400 });
  }

  const repositoryId = params.repositoryId ?? '';
  const revisionId = await publishedRevisionId(sql, repositoryId, 'model');
  if (!revisionId) return Response.json({ error: 'model not found' }, { status: 404 });
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${repositoryId}/revisions/${revisionId}/diffusers/generate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt ?? null,
        steps,
        guidance_scale: guidanceScale,
        width,
        height,
        seed,
      }),
    },
  );
  if (!upstream) return Response.json({ error: 'Diffusers runtime unavailable' }, { status: 503 });
  const body = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok || !body) {
    const detail = body && (body.error ?? body.detail);
    return Response.json({ error: typeof detail === 'string' ? detail : 'image generation failed' }, { status: upstream.status });
  }
  const artifactId = typeof body.artifact_id === 'string' ? body.artifact_id : null;
  if (!artifactId) return Response.json({ error: 'runtime returned no image' }, { status: 502 });
  const ticketSecret = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!ticketSecret) return Response.json({ error: 'artifact safety service unavailable' }, { status: 503 });
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = await signArtifactTicket(ticketSecret, profile.clerkUserId, artifactId, expires);
  return Response.json(
    {
      artifact_id: artifactId,
      image_url: `/api/runtime-artifacts/${encodeURIComponent(artifactId)}?expires=${expires}&signature=${encodeURIComponent(signature)}`,
      seed: body.seed,
      offline: body.offline === true,
    },
    { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } },
  );
};
