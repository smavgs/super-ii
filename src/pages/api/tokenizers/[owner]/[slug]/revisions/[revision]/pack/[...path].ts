import type { APIRoute } from 'astro';
import {
  resolveTokenizerModel,
  safeTokenizerArtifactPath,
  tokenizerArtifactResponse,
} from '@/lib/tokenizers';

export const GET: APIRoute = async ({ locals, params }) => {
  const path = safeTokenizerArtifactPath(params.path ?? '');
  if (!path) return Response.json({ error: 'invalid tokenizer artifact path' }, { status: 400 });
  const resolved = await resolveTokenizerModel(
    locals,
    params.owner ?? '',
    params.slug ?? '',
    params.revision ?? '',
  );
  if (!resolved.model) {
    return Response.json(
      { error: resolved.state === 'not_found' ? 'model revision not found' : 'repository service unavailable' },
      { status: resolved.state === 'not_found' ? 404 : 503 },
    );
  }
  return tokenizerArtifactResponse(locals, resolved.model, path);
};
