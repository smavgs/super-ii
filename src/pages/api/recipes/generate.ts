import type { APIRoute } from 'astro';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { generateProject, recipeRequest, type SdkInput } from '@/lib/engineering-recipes';
import { sdkManifestResponse } from '@/lib/sdk-manifest';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { recipeInputRequest } from '@/lib/recipe-access';

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const origin = new URL(request.url).origin;
  if (request.headers.has('origin') && request.headers.get('origin') !== origin) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const body = await readBoundedJsonObject(request, 16_384);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = recipeRequest.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(issue => issue.message).join('; ') }, { status: 422 });
  const sql = sqlClient(context.locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const rate = await consumeRateLimit(context.locals, request, sql, 'recipe.generate', 60, 60);
  if (rate !== 'allowed') return Response.json({ error: 'Recipe generation is temporarily unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  try {
    const resolved: Partial<Record<'generator' | 'embedding' | 'dataset', SdkInput>> = {};
    for (const role of ['generator', 'embedding', 'dataset'] as const) {
      const input = parsed.data[role];
      if (!input) continue;
      const [owner, slug] = input.repository.split('/');
      const response = await sdkManifestResponse({ ...context, params: { owner, slug }, request: recipeInputRequest(request, role, `${origin}/api/sdk/${role === 'dataset' ? 'datasets' : 'models'}/${owner}/${slug}?revision=${input.revision}`) }, role === 'dataset' ? 'dataset' : 'model');
      if (!response.ok) return Response.json({ error: `The ${role} revision is unavailable or access is denied` }, { status: response.status });
      resolved[role] = await response.json() as SdkInput;
    }
    const project = generateProject(parsed.data, resolved as { generator: SdkInput; embedding?: SdkInput; dataset?: SdkInput });
    return Response.json(project, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Recipe generation failed' }, { status: 422 });
  }
};
