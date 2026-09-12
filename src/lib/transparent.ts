import { z } from 'zod';

export const TRANSPARENT_PROVIDER = 'huggingface' as const;
export const TRANSPARENT_CRITERIA_VERSION = 'hf-public-v1.0' as const;
export const TRANSPARENT_MAX_FILES = 5_000;
export const TRANSPARENT_MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
export const TRANSPARENT_MAX_EVIDENCE_FILE_BYTES = 256 * 1024;

const HF_ORIGIN = 'https://huggingface.co';
const HF_HOSTS = new Set(['huggingface.co', 'www.huggingface.co']);
const SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const REVISION_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type TransparencyRepositoryKind = 'model' | 'dataset' | 'space';
export type TransparencyEvidenceState = 'verified' | 'declared' | 'derived' | 'unknown';

export type TransparencySource = {
  id: string;
  label: string;
  url: string;
  observed_at: string;
};

export type TransparencyEvidence = {
  id: string;
  label: string;
  state: TransparencyEvidenceState;
  summary: string;
  value: string | number | string[] | null;
  source_ids: string[];
  method: string | null;
};

export type TransparencyReport = {
  schema_version: '1.0';
  report_key: string;
  provider: typeof TRANSPARENT_PROVIDER;
  criteria_version: typeof TRANSPARENT_CRITERIA_VERSION;
  checked_at: string;
  repository: {
    kind: TransparencyRepositoryKind;
    id: string;
    owner: string;
    slug: string;
    canonical_url: string;
    revision_url: string;
    requested_revision: string;
    resolved_revision: string;
    visibility: 'public' | 'gated';
    last_modified: string | null;
  };
  coverage: {
    total: number;
    established: number;
    unknown: number;
    by_state: Record<TransparencyEvidenceState, number>;
  };
  evidence: TransparencyEvidence[];
  sources: TransparencySource[];
  limitations: string[];
};

export type ParsedTransparencySource = {
  kind: TransparencyRepositoryKind;
  repositoryId: string;
  owner: string;
  slug: string;
  requestedRevision: string;
  canonicalUrl: string;
};

export const transparencyCheckInputSchema = z.object({
  source: z.string().trim().min(1).max(2_048),
  revision: z.string().trim().max(200).optional(),
}).strict();

export class TransparencyError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 413 | 422 | 429 | 502 | 503;

  constructor(
    code: string,
    message: string,
    status: 400 | 404 | 413 | 422 | 429 | 502 | 503 = 422,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'TransparencyError';
  }
}

function safeSegment(value: string): string | null {
  const normalized = value.normalize('NFC');
  return SEGMENT_PATTERN.test(normalized) ? normalized : null;
}

function safeRepositoryPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.length > 1_024 || normalized.includes('\0')) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 255)) return null;
  return normalized;
}

function safeRevision(value: string): string | null {
  const normalized = value.normalize('NFC').trim();
  return REVISION_PATTERN.test(normalized) && !normalized.endsWith('/') ? normalized : null;
}

function decodeParts(pathname: string): string[] | null {
  try {
    return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function canonicalRepositoryUrl(kind: TransparencyRepositoryKind, owner: string, slug: string): string {
  const prefix = kind === 'model' ? '' : kind === 'dataset' ? '/datasets' : '/spaces';
  return `${HF_ORIGIN}${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
}

export function parseTransparencySource(source: string, explicitRevision?: string): ParsedTransparencySource {
  const input = source.trim();
  let parts: string[] | null = null;
  let revisionFromUrl = '';

  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new TransparencyError('invalid_source', 'Paste a valid Hugging Face repository URL.');
    }
    if (url.protocol !== 'https:' || !HF_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
      throw new TransparencyError('unsupported_source', 'Only public https://huggingface.co repository links are supported.');
    }
    parts = decodeParts(url.pathname);
  } else {
    const normalized = input.replace(/^hf:\/\//i, '').replace(/^huggingface:/i, '');
    parts = decodeParts(`/${normalized}`);
  }

  if (!parts || parts.length < 2) {
    throw new TransparencyError('repository_required', 'Use a model, dataset, or Space repository—not a profile or search page.');
  }

  let kind: TransparencyRepositoryKind = 'model';
  let offset = 0;
  if (parts[0] === 'datasets') {
    kind = 'dataset';
    offset = 1;
  } else if (parts[0] === 'spaces') {
    kind = 'space';
    offset = 1;
  } else if (['api', 'docs', 'models', 'organizations', 'settings', 'search'].includes(parts[0])) {
    throw new TransparencyError('unsupported_source', 'That Hugging Face page is not a repository.');
  }

  const owner = safeSegment(parts[offset] ?? '');
  const slug = safeSegment(parts[offset + 1] ?? '');
  if (!owner || !slug) throw new TransparencyError('invalid_repository', 'The Hugging Face owner or repository name is invalid.');

  const view = parts[offset + 2];
  if (view && ['tree', 'blob', 'commit'].includes(view)) {
    revisionFromUrl = parts[offset + 3] ?? '';
  } else if (view) {
    throw new TransparencyError('unsupported_repository_path', 'Paste the repository root or a tree, blob, or commit URL.');
  }

  const requestedRevision = safeRevision(explicitRevision?.trim() || revisionFromUrl || 'main');
  if (!requestedRevision) throw new TransparencyError('invalid_revision', 'Revision must be a branch, tag, or commit name without traversal segments.');
  const canonicalUrl = canonicalRepositoryUrl(kind, owner, slug);
  return { kind, repositoryId: `${owner}/${slug}`, owner, slug, requestedRevision, canonicalUrl };
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new TransparencyError('provider_response_invalid', 'Hugging Face returned invalid response metadata.', 502);
    if (length > maxBytes) throw new TransparencyError('provider_response_too_large', 'The public evidence response exceeds the checker limit.', 413);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TransparencyError('provider_response_too_large', 'The public evidence response exceeds the checker limit.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new TransparencyError('provider_response_invalid', 'Hugging Face returned text that could not be decoded safely.', 502);
  }
}

async function hfResponse(target: URL, maxBytes: number): Promise<{ response: Response; text: string }> {
  if (target.protocol !== 'https:' || !HF_HOSTS.has(target.hostname.toLowerCase()) || target.username || target.password || target.port) {
    throw new TransparencyError('provider_boundary', 'The provider request left the approved Hugging Face boundary.', 502);
  }
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { accept: 'application/json, text/plain;q=0.9', 'user-agent': 'Superii-Transparent/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TransparencyError('provider_unavailable', 'Hugging Face did not answer within the checker limit.', 503);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new TransparencyError('provider_redirect_rejected', 'Hugging Face returned an incomplete redirect.', 502);
    const redirected = new URL(location, target);
    if (
      redirected.protocol !== 'https:'
      || !HF_HOSTS.has(redirected.hostname.toLowerCase())
      || !redirected.pathname.startsWith('/api/resolve-cache/')
    ) throw new TransparencyError('provider_redirect_rejected', 'Evidence retrieval refused a redirect outside the approved Hugging Face cache.', 502);
    response = await fetch(redirected, {
      headers: { accept: 'application/json, text/plain;q=0.9', 'user-agent': 'Superii-Transparent/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { throw new TransparencyError('provider_unavailable', 'Hugging Face evidence retrieval timed out.', 503); });
  }
  if (response.status === 404) throw new TransparencyError('repository_not_found', 'That public repository or revision was not found.', 404);
  if (response.status === 401 || response.status === 403) throw new TransparencyError('public_evidence_unavailable', 'This repository or revision is not publicly readable.', 404);
  if (response.status === 429) throw new TransparencyError('provider_rate_limited', 'Hugging Face is rate limiting checks. Try again later.', 429);
  if (!response.ok) throw new TransparencyError('provider_unavailable', 'Hugging Face could not provide the requested public evidence.', 503);
  return { response, text: await boundedText(response, maxBytes) };
}

function apiPath(kind: TransparencyRepositoryKind, repositoryId: string, revision: string): string {
  const collection = kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
  const encodedId = repositoryId.split('/').map(encodeURIComponent).join('/');
  return `/api/${collection}/${encodedId}/revision/${encodeURIComponent(revision)}?blobs=true`;
}

type ProviderFile = { path: string; size: number | null; lfsSha256: string | null; blobId: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, max = 2_048): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringList(value: unknown, maxItems = 50): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(values.map((item) => stringValue(item, 200)).filter(Boolean))].slice(0, maxItems);
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cardValue(card: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (card[key] !== undefined && card[key] !== null) return card[key];
  return undefined;
}

function fileSourceId(path: string): string {
  return `file-${path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function hasSection(markdown: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(markdown));
}

function evidence(
  id: string,
  label: string,
  state: TransparencyEvidenceState,
  summary: string,
  value: TransparencyEvidence['value'],
  sourceIds: string[],
  method: string | null = null,
): TransparencyEvidence {
  return { id, label, state, summary, value, source_ids: sourceIds, method };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchEvidenceFile(
  parsed: ParsedTransparencySource,
  revision: string,
  file: ProviderFile,
  checkedAt: string,
): Promise<{ text: string; source: TransparencySource } | null> {
  if (file.size !== null && file.size > TRANSPARENT_MAX_EVIDENCE_FILE_BYTES) return null;
  const prefix = parsed.kind === 'model' ? '' : parsed.kind === 'dataset' ? '/datasets' : '/spaces';
  const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
  const url = `${HF_ORIGIN}${prefix}/${parsed.repositoryId.split('/').map(encodeURIComponent).join('/')}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
  try {
    const result = await hfResponse(new URL(url), TRANSPARENT_MAX_EVIDENCE_FILE_BYTES);
    return {
      text: result.text,
      source: { id: fileSourceId(file.path), label: file.path, url, observed_at: checkedAt },
    };
  } catch (error) {
    if (error instanceof TransparencyError && ['repository_not_found', 'public_evidence_unavailable', 'provider_redirect_rejected'].includes(error.code)) return null;
    throw error;
  }
}

export async function checkHuggingFaceTransparency(input: z.infer<typeof transparencyCheckInputSchema>): Promise<TransparencyReport> {
  const parsed = parseTransparencySource(input.source, input.revision);
  const checkedAt = new Date().toISOString();
  const metadataUrl = new URL(apiPath(parsed.kind, parsed.repositoryId, parsed.requestedRevision), HF_ORIGIN);
  const metadataResult = await hfResponse(metadataUrl, TRANSPARENT_MAX_PROVIDER_BYTES);
  let payload: Record<string, unknown>;
  try {
    const value = JSON.parse(metadataResult.text) as unknown;
    payload = record(value);
    if (!Object.keys(payload).length) throw new Error('empty');
  } catch {
    throw new TransparencyError('provider_response_invalid', 'Hugging Face returned invalid repository metadata.', 502);
  }

  const providerId = stringValue(payload.id ?? payload.modelId, 511);
  const resolvedRevision = stringValue(payload.sha, 64).toLowerCase();
  if (providerId.toLowerCase() !== parsed.repositoryId.toLowerCase() || !SHA_PATTERN.test(resolvedRevision)) {
    throw new TransparencyError('provider_identity_mismatch', 'Hugging Face did not return the requested repository and exact revision.', 502);
  }
  if (payload.private === true) throw new TransparencyError('public_evidence_unavailable', 'Super ii Transparent checks public evidence only.', 404);

  const siblings = Array.isArray(payload.siblings) ? payload.siblings : [];
  if (siblings.length > TRANSPARENT_MAX_FILES) {
    throw new TransparencyError('repository_too_many_files', `This repository has more than the ${TRANSPARENT_MAX_FILES.toLocaleString()}-file checker limit.`, 413);
  }
  const files: ProviderFile[] = [];
  for (const raw of siblings) {
    const item = record(raw);
    const path = safeRepositoryPath(item.rfilename);
    if (!path) continue;
    const size = numberValue(item.size);
    const lfs = record(item.lfs);
    files.push({
      path,
      size: size !== null && Number.isSafeInteger(size) ? size : null,
      lfsSha256: /^[a-f0-9]{64}$/.test(stringValue(lfs.sha256, 64).toLowerCase()) ? stringValue(lfs.sha256, 64).toLowerCase() : null,
      blobId: stringValue(item.blobId ?? item.blob_id, 128) || null,
    });
  }

  const rootFile = (name: string) => files.find((file) => file.path.toLowerCase() === name.toLowerCase());
  const licenseFile = files.find((file) => /^(?:license|licence)(?:\.[a-z0-9._-]+)?$/i.test(file.path));
  const readmeFile = rootFile('README.md');
  const configFile = rootFile('config.json');
  const datasetInfoFile = rootFile('dataset_infos.json');
  const fetched = await Promise.all(
    [readmeFile, configFile, datasetInfoFile].filter((file): file is ProviderFile => Boolean(file)).map((file) => fetchEvidenceFile(parsed, resolvedRevision, file, checkedAt)),
  );
  const evidenceFiles = new Map(fetched.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => [item.source.label, item]));
  const readme = evidenceFiles.get('README.md')?.text ?? '';
  let config: Record<string, unknown> = {};
  const configText = evidenceFiles.get('config.json')?.text;
  if (configText) {
    try { config = record(JSON.parse(configText)); } catch { config = {}; }
  }
  let datasetInfo: Record<string, unknown> = {};
  const datasetInfoText = evidenceFiles.get('dataset_infos.json')?.text;
  if (datasetInfoText) {
    try { datasetInfo = record(JSON.parse(datasetInfoText)); } catch { datasetInfo = {}; }
  }

  const metadataSource: TransparencySource = { id: 'hf-api', label: 'Hugging Face repository API at the exact revision', url: metadataUrl.toString(), observed_at: checkedAt };
  const revisionUrl = `${parsed.canonicalUrl}/tree/${resolvedRevision}`;
  const revisionSource: TransparencySource = { id: 'hf-revision', label: 'Exact Hugging Face repository revision', url: revisionUrl, observed_at: checkedAt };
  const sources = [metadataSource, revisionSource, ...evidenceFiles.values()].map((item) => 'source' in item ? item.source : item);
  if (licenseFile && !sources.some((source) => source.id === fileSourceId(licenseFile.path))) {
    const encodedPath = licenseFile.path.split('/').map(encodeURIComponent).join('/');
    sources.push({ id: fileSourceId(licenseFile.path), label: licenseFile.path, url: `${parsed.canonicalUrl}/blob/${resolvedRevision}/${encodedPath}`, observed_at: checkedAt });
  }

  const card = record(payload.cardData);
  const tags = stringList(payload.tags, 100);
  const license = stringValue(cardValue(card, 'license'), 160)
    || tags.find((tag) => tag.startsWith('license:'))?.slice('license:'.length)
    || '';
  const languages = stringList(cardValue(card, 'language', 'languages'));
  const datasets = stringList(cardValue(card, 'datasets', 'dataset'));
  const baseModels = stringList(cardValue(card, 'base_model', 'base_models'));
  const metrics = stringList(cardValue(card, 'metrics', 'metric'));
  const pipeline = stringValue(payload.pipeline_tag ?? card.pipeline_tag, 160);
  const library = stringValue(payload.library_name ?? card.library_name, 160);
  const sdk = stringValue(payload.sdk ?? card.sdk, 160);
  const architectures = stringList(config.architectures);
  const totalKnownSize = files.length && files.every((file) => file.size !== null)
    ? files.reduce((total, file) => total + (file.size ?? 0), 0)
    : null;
  const extensions = [...new Set(files.map((file) => {
    const name = file.path.split('/').pop() ?? '';
    if (name === '.gitattributes') return '.gitattributes';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '(no extension)';
  }))].sort().slice(0, 40);
  const safetensors = record(payload.safetensors);
  const parameterTotal = numberValue(safetensors.total);
  const readmeSource = readme ? [fileSourceId('README.md')] : [];
  const cardSources = ['hf-api', ...readmeSource];
  const fileSources = ['hf-api', 'hf-revision'];

  const items: TransparencyEvidence[] = [
    evidence('exact-revision', 'Exact revision', 'verified', 'The provider resolved the requested revision to an immutable commit SHA.', resolvedRevision, ['hf-api', 'hf-revision']),
    evidence('public-access', 'Public evidence access', 'verified', payload.gated ? 'Repository metadata is public; some files are gated by Hugging Face.' : 'Repository metadata and the inspected evidence files are publicly readable.', payload.gated ? 'gated' : 'public', ['hf-api']),
    evidence('repository-identity', 'Repository identity', 'verified', 'The returned provider identity matches the requested owner, repository, and type.', `${parsed.kind}:${providerId}`, ['hf-api']),
    evidence('file-manifest', 'File manifest', 'verified', `${files.length.toLocaleString()} safe repository paths were observed at the exact revision.`, files.length, fileSources),
    readme
      ? evidence('repository-card', 'Repository card', 'verified', 'README.md was read at the exact revision within the evidence byte limit.', 'README.md', readmeSource)
      : evidence('repository-card', 'Repository card', 'unknown', readmeFile ? 'README.md exists but was not publicly readable within the checker boundary.' : 'No root README.md was observed.', null, readmeFile ? ['hf-api'] : [], null),
    license
      ? evidence('license-declaration', 'License declaration', 'declared', `The repository card metadata declares “${license}”.`, license, cardSources)
      : evidence('license-declaration', 'License declaration', 'unknown', 'No structured license identifier was found in the public card metadata.', null, ['hf-api']),
    licenseFile
      ? evidence('license-file', 'License file', 'verified', `${licenseFile.path} is present at the exact revision. Presence does not establish that it covers every file.`, licenseFile.path, ['hf-api', fileSourceId(licenseFile.path)])
      : evidence('license-file', 'License file', 'unknown', 'No root LICENSE or LICENCE file was observed.', null, ['hf-api']),
    totalKnownSize !== null
      ? evidence('repository-size', 'Repository size', 'derived', `The total is the sum of ${files.length.toLocaleString()} provider-reported file sizes.`, formatBytes(totalKnownSize), ['hf-api'], 'Sum of all complete file-size values returned by the exact-revision API response.')
      : evidence('repository-size', 'Repository size', 'unknown', 'The provider response did not include a complete size for every file.', null, ['hf-api']),
    extensions.length
      ? evidence('file-formats', 'File formats', 'derived', 'Extensions were grouped from safe paths in the exact-revision manifest.', extensions, ['hf-api'], 'Unique lowercase filename extensions; content was not executed or inferred from extension alone.')
      : evidence('file-formats', 'File formats', 'unknown', 'No file extensions could be derived.', null, ['hf-api']),
    languages.length
      ? evidence('languages', 'Languages', 'declared', 'Language identifiers are declared in repository card metadata.', languages, cardSources)
      : evidence('languages', 'Languages', 'unknown', 'No structured language declaration was found.', null, ['hf-api']),
    hasSection(readme, [/^#{1,4}\s+.*(?:intended use|uses)\b/im, /\bintended use(?:s)?\b/i])
      ? evidence('intended-use', 'Intended use', 'declared', 'The repository card contains an intended-use statement or section.', 'Present in repository card', readmeSource)
      : evidence('intended-use', 'Intended use', 'unknown', 'No intended-use statement was detected in the bounded repository card.', null, readmeSource),
    hasSection(readme, [/^#{1,4}\s+.*(?:limitation|known issue)/im, /\blimitations?\b/i])
      ? evidence('limitations', 'Limitations', 'declared', 'The repository card contains a limitations or known-issues statement.', 'Present in repository card', readmeSource)
      : evidence('limitations', 'Limitations', 'unknown', 'No limitations statement was detected in the bounded repository card.', null, readmeSource),
    hasSection(readme, [/^#{1,4}\s+.*(?:bias|risk|ethical|safety)/im, /\b(?:biases|ethical considerations|risks?)\b/i])
      ? evidence('responsible-use', 'Risks, bias, or responsible use', 'declared', 'The repository card contains a risk, bias, ethics, or safety statement.', 'Present in repository card', readmeSource)
      : evidence('responsible-use', 'Risks, bias, or responsible use', 'unknown', 'No risk, bias, ethics, or safety statement was detected.', null, readmeSource),
    hasSection(readme, [/^#{1,4}\s+.*(?:evaluation|benchmark|results?)/im]) || metrics.length
      ? evidence('evaluation', 'Evaluation evidence', 'declared', metrics.length ? 'Evaluation metrics are declared in structured card metadata.' : 'The repository card contains an evaluation, benchmark, or results section.', metrics.length ? metrics : 'Present in repository card', cardSources)
      : evidence('evaluation', 'Evaluation evidence', 'unknown', 'No structured metrics or evaluation section was detected.', null, cardSources),
    baseModels.length || datasets.length || hasSection(readme, [/^#{1,4}\s+.*(?:training data|provenance|source data)/im])
      ? evidence('provenance', 'Provenance', 'declared', 'The repository declares upstream models, datasets, training data, or provenance.', [...baseModels.map((value) => `model:${value}`), ...datasets.map((value) => `dataset:${value}`)].slice(0, 50), cardSources)
      : evidence('provenance', 'Provenance', 'unknown', 'No structured upstream model, dataset, training-data, or provenance declaration was detected.', null, cardSources),
  ];

  if (parsed.kind === 'model') {
    items.push(
      pipeline
        ? evidence('model-task', 'Model task', 'declared', 'The task is declared by the provider/card metadata.', pipeline, ['hf-api'])
        : evidence('model-task', 'Model task', 'unknown', 'No pipeline task is declared.', null, ['hf-api']),
      library
        ? evidence('model-library', 'Model library', 'declared', 'The library is declared by the provider/card metadata.', library, ['hf-api'])
        : evidence('model-library', 'Model library', 'unknown', 'No model library is declared.', null, ['hf-api']),
      architectures.length
        ? evidence('model-architecture', 'Architecture', 'declared', 'Architecture names are declared in config.json at the exact revision.', architectures, [fileSourceId('config.json')])
        : evidence('model-architecture', 'Architecture', 'unknown', 'No architecture list was found in a readable config.json.', null, configText ? [fileSourceId('config.json')] : ['hf-api']),
      parameterTotal !== null
        ? evidence('parameter-count', 'Parameter count', 'derived', 'The parameter total is derived from Hugging Face safetensors metadata.', parameterTotal, ['hf-api'], 'Provider safetensors.total value; Super ii did not load model weights.')
        : evidence('parameter-count', 'Parameter count', 'unknown', 'No bounded safetensors parameter total was available.', null, ['hf-api']),
      files.some((file) => file.path.toLowerCase().endsWith('.safetensors'))
        ? evidence('weight-format', 'Safetensors weights', 'verified', 'At least one .safetensors path is present at the exact revision.', 'present', ['hf-api'])
        : evidence('weight-format', 'Safetensors weights', 'unknown', 'No .safetensors file path was observed.', null, ['hf-api']),
      baseModels.length
        ? evidence('base-model', 'Base model', 'declared', 'One or more base models are declared in card metadata.', baseModels, cardSources)
        : evidence('base-model', 'Base model', 'unknown', 'No structured base-model declaration was found.', null, cardSources),
      datasets.length
        ? evidence('training-datasets', 'Training datasets', 'declared', 'One or more datasets are declared in card metadata.', datasets, cardSources)
        : evidence('training-datasets', 'Training datasets', 'unknown', 'No structured training-dataset declaration was found.', null, cardSources),
    );
  } else if (parsed.kind === 'dataset') {
    const taskCategories = stringList(cardValue(card, 'task_categories', 'task_ids'));
    const configurations = Object.keys(datasetInfo).slice(0, 100);
    items.push(
      taskCategories.length
        ? evidence('dataset-tasks', 'Dataset tasks', 'declared', 'Task categories are declared in card metadata.', taskCategories, cardSources)
        : evidence('dataset-tasks', 'Dataset tasks', 'unknown', 'No structured task categories were found.', null, cardSources),
      configurations.length
        ? evidence('dataset-configurations', 'Dataset configurations', 'verified', 'Configuration keys were observed in dataset_infos.json at the exact revision.', configurations, [fileSourceId('dataset_infos.json')])
        : evidence('dataset-configurations', 'Dataset configurations', 'unknown', 'No readable dataset_infos.json configurations were available.', null, datasetInfoText ? [fileSourceId('dataset_infos.json')] : ['hf-api']),
      hasSection(readme, [/^#{1,4}\s+.*(?:collection|curation|annotation)/im])
        ? evidence('collection-process', 'Collection and curation', 'declared', 'The dataset card contains collection, curation, or annotation documentation.', 'Present in dataset card', readmeSource)
        : evidence('collection-process', 'Collection and curation', 'unknown', 'No collection, curation, or annotation section was detected.', null, readmeSource),
      hasSection(readme, [/^#{1,4}\s+.*(?:personal|sensitive|privacy|pii)/im, /\bpersonally identifiable\b/i])
        ? evidence('sensitive-data', 'Sensitive or personal data', 'declared', 'The dataset card contains a privacy, PII, personal, or sensitive-data statement.', 'Present in dataset card', readmeSource)
        : evidence('sensitive-data', 'Sensitive or personal data', 'unknown', 'No sensitive-data or privacy statement was detected.', null, readmeSource),
    );
  } else {
    const linkedModels = stringList(payload.models ?? card.models);
    const linkedDatasets = stringList(payload.datasets ?? card.datasets);
    const appFile = files.find((file) => ['app.py', 'index.html', 'streamlit_app.py'].includes(file.path.toLowerCase()));
    items.push(
      sdk
        ? evidence('space-sdk', 'Space SDK', 'declared', 'The Space SDK is declared by provider/card metadata.', sdk, ['hf-api'])
        : evidence('space-sdk', 'Space SDK', 'unknown', 'No Space SDK is declared.', null, ['hf-api']),
      appFile
        ? evidence('space-entrypoint', 'App entry file', 'verified', `${appFile.path} is present. Super ii did not execute or inspect its code.`, appFile.path, ['hf-api'])
        : evidence('space-entrypoint', 'App entry file', 'unknown', 'No conventional root app entry file was observed.', null, ['hf-api']),
      linkedModels.length
        ? evidence('space-models', 'Linked models', 'declared', 'Models are declared in Space metadata.', linkedModels, ['hf-api'])
        : evidence('space-models', 'Linked models', 'unknown', 'No linked models are declared.', null, ['hf-api']),
      linkedDatasets.length
        ? evidence('space-datasets', 'Linked datasets', 'declared', 'Datasets are declared in Space metadata.', linkedDatasets, ['hf-api'])
        : evidence('space-datasets', 'Linked datasets', 'unknown', 'No linked datasets are declared.', null, ['hf-api']),
    );
  }

  const byState: Record<TransparencyEvidenceState, number> = { verified: 0, declared: 0, derived: 0, unknown: 0 };
  for (const item of items) byState[item.state] += 1;
  const reportKey = await sha256Hex(`${TRANSPARENT_PROVIDER}\n${parsed.kind}\n${providerId.toLowerCase()}\n${resolvedRevision}\n${TRANSPARENT_CRITERIA_VERSION}`);
  return {
    schema_version: '1.0',
    report_key: reportKey,
    provider: TRANSPARENT_PROVIDER,
    criteria_version: TRANSPARENT_CRITERIA_VERSION,
    checked_at: checkedAt,
    repository: {
      kind: parsed.kind,
      id: providerId,
      owner: providerId.split('/')[0] ?? parsed.owner,
      slug: providerId.split('/')[1] ?? parsed.slug,
      canonical_url: parsed.canonicalUrl,
      revision_url: revisionUrl,
      requested_revision: parsed.requestedRevision,
      resolved_revision: resolvedRevision,
      visibility: payload.gated ? 'gated' : 'public',
      last_modified: stringValue(payload.lastModified, 80) || null,
    },
    coverage: {
      total: items.length,
      established: items.length - byState.unknown,
      unknown: byState.unknown,
      by_state: byState,
    },
    evidence: items,
    sources,
    limitations: [
      'This report covers public evidence available from Hugging Face at one exact repository commit.',
      'Verified means directly observed by this bounded checker. It does not certify a creator claim as true, safe, lawful, or complete.',
      'Declared means the repository or provider states it. Super ii has not independently reproduced the statement.',
      'Derived means the method shown produced the value from observed metadata. Unknown means the public evidence did not establish it.',
      'Super ii did not execute repository code, load model weights, scan every file body, test safety, or assess legal suitability.',
      'A newer repository revision can differ. Recheck to create a new immutable report and compare revisions.',
      'Hugging Face identifies the public source. This report does not imply endorsement, partnership, or affiliation.',
    ],
  };
}

export function compareTransparencyReports(left: TransparencyReport, right: TransparencyReport) {
  if (
    left.provider !== right.provider
    || left.repository.kind !== right.repository.kind
    || left.repository.id.toLowerCase() !== right.repository.id.toLowerCase()
  ) throw new TransparencyError('comparison_mismatch', 'Only two reports for the same Hugging Face repository can be compared.');
  const leftById = new Map(left.evidence.map((item) => [item.id, item]));
  const rightById = new Map(right.evidence.map((item) => [item.id, item]));
  const ids = [...new Set([...leftById.keys(), ...rightById.keys()])].sort();
  const changes = ids.flatMap((id) => {
    const before = leftById.get(id) ?? null;
    const after = rightById.get(id) ?? null;
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ id, label: after?.label ?? before?.label ?? id, before, after }];
  });
  return {
    repository: right.repository.id,
    from: { report_key: left.report_key, revision: left.repository.resolved_revision, checked_at: left.checked_at },
    to: { report_key: right.report_key, revision: right.repository.resolved_revision, checked_at: right.checked_at },
    changed_count: changes.length,
    changes,
  };
}
