import { waitUntil } from 'cloudflare:workers';
import { sqlClient } from './db';
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

function isRecordedTokenizerManifest(value: unknown, revisionId: string): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return manifest.version === 'superii-tokenizer-pack-v1'
    && manifest.source_revision_id === revisionId
    && typeof manifest.pack_sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(manifest.pack_sha256)
    && Array.isArray(manifest.artifacts)
    && Array.isArray(manifest.verification_vectors)
    && manifest.verification_vectors.length > 0;
}

async function recordedTokenizerManifest(
  locals: App.Locals,
  model: TokenizerModel,
): Promise<Record<string, unknown> | null> {
  const sql = sqlClient(locals);
  if (!sql) return null;
  try {
    const rows = await sql`
      select analysis.result->'manifest' as manifest
      from app.repository_revision_analyses analysis
      join app.repository_revisions revision
        on revision.id = analysis.revision_id
       and revision.repository_id = analysis.repository_id
      join app.repositories repository
        on repository.id = revision.repository_id
      where analysis.repository_id = ${model.repositoryId}
        and analysis.revision_id = ${model.revisionId}
        and analysis.analysis_type = 'tokenizer'
        and analysis.status = 'passed'
        and analysis.result->>'verified' = 'true'
        and coalesce(analysis.result->>'applicable', 'true') = 'true'
        and revision.status = 'published'
        and repository.status = 'published'
        and repository.visibility = 'public'
      limit 1
    `;
    const manifest = rows[0]?.manifest;
    return isRecordedTokenizerManifest(manifest, model.revisionId) ? manifest : null;
  } catch {
    return null;
  }
}

function publicTokenizerManifest(model: TokenizerModel, manifest: Record<string, unknown>) {
  return {
    ...manifest,
    model_commit_sha: model.commitSha,
    artifact_url_template: `/api/tokenizers/${encodeURIComponent(model.owner)}/${encodeURIComponent(model.slug)}/revisions/${encodeURIComponent(model.revisionId)}/pack/{path}`,
  };
}

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
  if (operation === 'manifest') {
    const recorded = await recordedTokenizerManifest(locals, model);
    if (recorded) return { status: 200, value: publicTokenizerManifest(model, recorded) };
  }
  const upstream = await tokenizerRuntimeFetch(locals, model, operation, payload);
  if (!upstream) return { status: 503, value: { error: 'tokenizer runtime unavailable' } };
  if (!upstream.ok) {
    const status = upstream.status === 404
      ? 404
      : upstream.status === 429
        ? 429
        : upstream.status >= 500
          ? 503
          : 422;
    return {
      status,
      value: { error: upstream.status === 404 ? 'verified tokenizer not found' : 'verified tokenizer request failed' },
    };
  }
  try {
    const value = await upstream.json() as Record<string, unknown>;
    return {
      status: 200,
      value: operation === 'manifest'
        ? publicTokenizerManifest(model, value)
        : { ...value, model_commit_sha: model.commitSha },
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
  request: Request,
): Promise<Response> {
  const cacheStorage = typeof caches === 'undefined'
    ? null
    : caches as CacheStorage & { default: Cache };
  const cache = cacheStorage?.default ?? null;
  const cacheKey = new Request(request.url, { method: 'GET' });
  let cached: Response | undefined;
  try {
    cached = cache ? await cache.match(cacheKey) : undefined;
  } catch (error) {
    console.warn('Tokenizer artifact edge cache read failed', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  if (cached) return cached;

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
  const response = proxiedFileResponse(upstream, true);
  if (cache) {
    waitUntil(cache.put(cacheKey, response.clone()).catch((error: unknown) => {
      console.warn('Tokenizer artifact edge cache write failed', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
    }));
  }
  return response;
}
