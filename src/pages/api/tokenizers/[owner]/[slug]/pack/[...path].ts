import type { APIRoute } from 'astro';
import { resolveTokenizerModel, safeTokenizerArtifactPath } from '@/lib/tokenizers';

export const GET: APIRoute = async ({ locals, params, request }) => {
  const path = safeTokenizerArtifactPath(params.path ?? '');
  if (!path) return Response.json({ error: 'invalid tokenizer artifact path' }, { status: 400 });
  const revision = new URL(request.url).searchParams.get('revision') ?? undefined;
  const resolved = await resolveTokenizerModel(locals, params.owner ?? '', params.slug ?? '', revision);
  if (!resolved.model) return Response.json({ error: resolved.state === 'not_found' ? 'model not found' : 'repository service unavailable' }, { status: resolved.state === 'not_found' ? 404 : 503 });
  const segments = path.split('/').map(encodeURIComponent).join('/');
  const target = new URL(
    `/api/tokenizers/${encodeURIComponent(resolved.model.owner)}/${encodeURIComponent(resolved.model.slug)}/revisions/${encodeURIComponent(resolved.model.revisionId)}/pack/${segments}`,
    request.url,
  );
  return new Response(null, {
    status: 307,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
