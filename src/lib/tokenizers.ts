import { getPublicRepository } from './repository';
import { proxiedFileResponse, runtimeFetch } from './runtime';

const REVISION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TokenizerModel = {
  repositoryId: string;
  revisionId: string;
  commitSha: string | null;
  owner: string;
  slug: string;
};

export type TokenizerResolution =
  | { state: 'ok'; model: TokenizerModel }
  | { state: 'not_found' | 'unavailable'; model: null };

export function acceptsPublicMachineRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function resolveTokenizerModel(
  locals: App.Locals,
  owner: string,
  slug: string,
  requestedRevision?: string,
): Promise<TokenizerResolution> {
  if (requestedRevision && !REVISION_ID.test(requestedRevision)) {
    return { state: 'not_found', model: null };
  }
  const found = await getPublicRepository(locals, 'model', owner, slug);
  if (!found.repository) {
    return { state: found.state === 'not_found' ? 'not_found' : 'unavailable', model: null };
  }
  const version = requestedRevision
    ? found.repository.versions.find((candidate) => candidate.id === requestedRevision)
    : null;
  if (requestedRevision && !version) return { state: 'not_found', model: null };
  return {
    state: 'ok',
    model: {
      repositoryId: found.repository.id,
      revisionId: version?.id ?? found.repository.revision_id,
      commitSha: version?.commit_sha ?? found.repository.commit_sha,
      owner: found.repository.owner_handle,
      slug: found.repository.slug,
    },
  };
}

export async function tokenizerRuntimeFetch(
  locals: App.Locals,
  model: TokenizerModel,
  operation: 'manifest' | 'encode' | 'decode',
  payload?: Record<string, unknown>,
): Promise<Response | null> {
  const base = `/v1/repositories/${encodeURIComponent(model.repositoryId)}/revisions/${encodeURIComponent(model.revisionId)}`;
  const path = operation === 'manifest'
    ? `${base}/tokenizer-pack`
    : `${base}/${operation === 'encode' ? 'tokenize' : 'detokenize'}`;
  return runtimeFetch(locals, path, payload
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }
    : {});
}

export async function tokenizerJson(
  locals: App.Locals,
  model: TokenizerModel,
  operation: 'manifest' | 'encode' | 'decode',
  payload?: Record<string, unknown>,
): Promise<{ status: number; value: Record<string, unknown> }> {
  const upstream = await tokenizerRuntimeFetch(locals, model, operation, payload);
  if (!upstream) return { status: 503, value: { error: 'tokenizer runtime unavailable' } };
  if (!upstream.ok) {
    return {
      status: upstream.status === 404 ? 404 : upstream.status === 429 ? 429 : 422,
      value: { error: upstream.status === 404 ? 'verified tokenizer not found' : 'verified tokenizer request failed' },
    };
  }
  try {
    const value = await upstream.json() as Record<string, unknown>;
    return {
      status: 200,
      value: {
        ...value,
        model_commit_sha: model.commitSha,
        ...(operation === 'manifest'
          ? {
              artifact_url_template: `/api/tokenizers/${encodeURIComponent(model.owner)}/${encodeURIComponent(model.slug)}/revisions/${encodeURIComponent(model.revisionId)}/pack/{path}`,
            }
          : {}),
      },
    };
  } catch {
    return { status: 503, value: { error: 'tokenizer runtime returned an invalid response' } };
  }
}

export function tokenizerResponse(status: number, value: Record<string, unknown>, cache = false): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': cache && status === 200 ? 'public, max-age=300, stale-while-revalidate=3600' : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function safeTokenizerArtifactPath(value: string): string | null {
  if (!value || value.length > 1024 || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

export async function tokenizerArtifactResponse(
  locals: App.Locals,
  model: TokenizerModel,
  path: string,
): Promise<Response> {
  const segments = path.split('/').map(encodeURIComponent).join('/');
  const upstream = await runtimeFetch(
    locals,
    `/v1/repositories/${encodeURIComponent(model.repositoryId)}/revisions/${encodeURIComponent(model.revisionId)}/tokenizer-pack/${segments}`,
  );
  if (!upstream) return Response.json({ error: 'tokenizer runtime unavailable' }, { status: 503 });
  if (!upstream.ok) {
    return Response.json(
      { error: upstream.status === 404 ? 'tokenizer artifact not found' : 'verified tokenizer unavailable' },
      { status: upstream.status === 404 ? 404 : 422 },
    );
  }
  return proxiedFileResponse(upstream, true);
}
