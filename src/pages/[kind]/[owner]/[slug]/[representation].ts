import type { APIRoute } from 'astro';
import { repositoryRepresentationResponse } from '@/lib/agent-resources';
import { getPublicRepository } from '@/lib/repository';
import type { RepositoryKind } from '@/lib/catalog';

const kinds: Record<string, RepositoryKind> = {
  models: 'model',
  datasets: 'dataset',
  spaces: 'space',
};

export const GET: APIRoute = async ({ locals, params, request }) => {
  const kind = kinds[params.kind ?? ''];
  const owner = params.owner ?? '';
  const slug = params.slug ?? '';
  const representation = params.representation ?? '';
  if (!kind) return new Response('Not found', { status: 404 });
  const result = await getPublicRepository(locals, kind, owner, slug);
  if (!result.repository) {
    return Response.json(
      { error: result.state === 'error' ? 'repository service unavailable' : 'repository not found' },
      { status: result.state === 'error' ? 503 : 404 },
    );
  }
  return repositoryRepresentationResponse(
    result.repository,
    representation,
    new URL(request.url).origin,
  ) ?? Response.json({ error: 'representation not found' }, { status: 404 });
};
