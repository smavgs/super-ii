import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import runtimeRegistrySource from '@/content/runtime-registry.json';
import type { RepositoryBundle, RepositoryFileView } from './repository';
import { kindPath } from './repository-path';

export type ModelFormat = 'gguf' | 'safetensors' | 'pytorch' | 'onnx' | 'mlx' | 'diffusers' | 'dduf';
export type IntegrationCategory = 'library' | 'local-runtime' | 'browser' | 'desktop-app' | 'api-server' | 'hosted';
export type IntegrationStatus = 'verified' | 'registry-supported' | 'community' | 'failing' | 'unsupported';
export type HardwareOS = 'macos' | 'linux' | 'windows' | 'unknown';
export type HardwareArch = 'arm64' | 'x64' | 'unknown';
export type HardwareAccelerator = 'metal' | 'cuda' | 'rocm' | 'cpu' | 'unknown';

type RegistryCommand = {
  id: string;
  kind: 'install' | 'setup' | 'run' | 'serve';
  label: string;
  formats?: ModelFormat[];
  executable: string;
  args: string[];
};

type RegistryIntegration = {
  id: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  summary: string;
  documentation: string;
  verifiedAt: string;
  expiresAt: string;
  verification: string;
  platforms: string[];
  formats: ModelFormat[];
  accelerators: string[];
  capabilities: string[];
  priority: number;
  commands: RegistryCommand[];
  api?: {
    protocol: 'openai-compatible';
    baseUrl: string;
    chatPath: string;
  };
  warnings: string[];
};

type RegistryAgent = {
  id: 'codex' | 'pi' | 'hermes' | 'openclaw';
  name: string;
  status: IntegrationStatus;
  documentation: string;
  mode: 'mcp-discovery' | 'openai-compatible';
  summary: string;
  verifiedAt: string;
};

type RuntimeRegistry = {
  schemaVersion: 1;
  publishedAt: string;
  reviewCadenceDays: number;
  allowedTemplateTokens: string[];
  integrations: RegistryIntegration[];
  agents: RegistryAgent[];
  notebooks: Array<{
    id: string;
    name: string;
    status: string;
    url?: string;
    urlTemplate?: string;
    warning?: string;
  }>;
  hostedProviders: Array<Record<string, unknown>>;
};

export type HardwareProfile = {
  os: HardwareOS;
  architecture: HardwareArch;
  accelerator: HardwareAccelerator;
  ramGiB: number | null;
  vramGiB: number | null;
  webgpu: boolean;
};

export type RenderedCommand = {
  id: string;
  kind: RegistryCommand['kind'];
  label: string;
  posix: string;
  powershell: string;
  digest: {
    algorithm: 'sha256';
    posix: string;
    powershell: string;
  };
};

export type ModelUseCandidate = {
  id: string;
  integrationId: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  summary: string;
  documentation: string;
  verifiedAt: string;
  expiresAt: string;
  verification: string;
  platforms: string[];
  formats: ModelFormat[];
  matchedFormats: ModelFormat[];
  accelerators: string[];
  capabilities: string[];
  priority: number;
  minimumRamGiB: number | null;
  minimumVramGiB: number | null;
  primaryFile: null | {
    path: string;
    localPath: string;
    sha256: string;
    sizeBytes: string;
    downloadUrl: string;
  };
  commands: RenderedCommand[];
  generatedFiles: Array<{ path: string; content: string }>;
  snippets: Array<{ language: string; label: string; code: string }>;
  api: RegistryIntegration['api'] | null;
  endpointModelId: string | null;
  warnings: string[];
};

export type Recommendation = {
  candidateId: string;
  score: number;
  suitability: 'recommended' | 'compatible' | 'unknown' | 'incompatible';
  reasons: string[];
};

const runtimeRegistry = runtimeRegistrySource as unknown as RuntimeRegistry;
const encoder = new TextEncoder();
const GIB = 1024 ** 3;
const DERIVATION_TYPES = new Set([
  'fine-tuned-from',
  'fine_tuned_from',
  'quantized-from',
  'quantized_from',
  'converted-from',
  'converted_from',
  'adapter-for',
  'adapter_for',
  'merged-from',
  'merged_from',
  'distilled-from',
  'distilled_from',
]);

function digest(value: string): string {
  return bytesToHex(sha256(encoder.encode(value)));
}

function posixQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function replaceTokens(value: string, tokens: Record<string, string>): string {
  return value.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => tokens[key] ?? match);
}

function safeName(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || fallback;
}

function safePath(value: string): boolean {
  return value.length > 0
    && value.length <= 1_024
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function modelDirectory(repository: RepositoryBundle): string {
  return `./superii-${safeName(repository.owner_handle, 'owner')}-${safeName(repository.slug, 'model')}-r${repository.revision_sequence}`;
}

function fileDownloadUrl(repository: RepositoryBundle, file: RepositoryFileView, origin: string): string {
  return new URL(`/api/repositories/${repository.id}/files/${file.id}`, origin).toString();
}

function formatFiles(repository: RepositoryBundle, format: ModelFormat): RepositoryFileView[] {
  const files = repository.files.filter((file) => safePath(file.path));
  if (format === 'gguf') return files.filter((file) => file.path.toLowerCase().endsWith('.gguf'));
  if (format === 'safetensors') return files.filter((file) => file.path.toLowerCase().endsWith('.safetensors'));
  if (format === 'pytorch') return files.filter((file) => /\.(bin|pt|pth)$/i.test(file.path));
  if (format === 'onnx') return files.filter((file) => file.path.toLowerCase().endsWith('.onnx'));
  if (format === 'dduf') return files.filter((file) => file.path.toLowerCase().endsWith('.dduf'));
  if (format === 'mlx') {
    return files.filter((file) => /(^|\/)mlx|\.npz$/i.test(file.path));
  }
  if (format === 'diffusers') {
    return files.filter((file) => file.path.toLowerCase() === 'model_index.json');
  }
  return [];
}

export function detectModelFormats(repository: RepositoryBundle): ModelFormat[] {
  if (repository.kind !== 'model') return [];
  const paths = repository.files.map((file) => file.path.toLowerCase());
  const formats = new Set<ModelFormat>();
  if (paths.some((path) => path.endsWith('.gguf'))) formats.add('gguf');
  if (paths.some((path) => path.endsWith('.safetensors'))) formats.add('safetensors');
  if (paths.some((path) => /\.(bin|pt|pth)$/.test(path))) formats.add('pytorch');
  if (paths.some((path) => path.endsWith('.onnx'))) formats.add('onnx');
  if (paths.some((path) => path.endsWith('.dduf'))) formats.add('dduf');
  if (paths.includes('model_index.json')) formats.add('diffusers');
  if (
    repository.compatibility?.mlx_compatible === true
    || paths.some((path) => path.endsWith('.npz') || /(^|\/)mlx/.test(path))
  ) formats.add('mlx');
  return [...formats];
}

function selectedPrimaryFiles(
  repository: RepositoryBundle,
  integration: RegistryIntegration,
  matchedFormats: ModelFormat[],
): Array<RepositoryFileView | null> {
  const fileBased = matchedFormats.filter((format) => ['gguf', 'dduf'].includes(format));
  const selected = fileBased.flatMap((format) => formatFiles(repository, format));
  if (selected.length) return selected;
  if (integration.id === 'lm-studio' && matchedFormats.includes('mlx')) {
    return [formatFiles(repository, 'safetensors')[0] ?? formatFiles(repository, 'mlx')[0] ?? null];
  }
  return [null];
}

function renderCommand(command: RegistryCommand, tokens: Record<string, string>): RenderedCommand {
  const executable = replaceTokens(command.executable, tokens);
  const args = command.args.map((argument) => replaceTokens(argument, tokens));
  const posix = [executable, ...args.map(posixQuote)].join(' ');
  const powershell = `& ${[powershellQuote(executable), ...args.map(powershellQuote)].join(' ')}`;
  return {
    id: command.id,
    kind: command.kind,
    label: command.label,
    posix,
    powershell,
    digest: {
      algorithm: 'sha256',
      posix: digest(posix),
      powershell: digest(powershell),
    },
  };
}

function pythonSnippets(
  integrationId: string,
  localDirectory: string,
  matchedFormats: ModelFormat[],
  primaryFile: RepositoryFileView | null,
): ModelUseCandidate['snippets'] {
  if (integrationId === 'transformers') {
    if (!matchedFormats.includes('safetensors')) return [];
    return [{
      language: 'python',
      label: 'Load local reviewed files',
      code: `from transformers import AutoModel, AutoTokenizer\n\nmodel_dir = ${JSON.stringify(localDirectory)}\ntokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)\nmodel = AutoModel.from_pretrained(model_dir, local_files_only=True, use_safetensors=True)\nprint(type(model).__name__, type(tokenizer).__name__)`,
    }];
  }
  if (integrationId === 'diffusers') {
    const ddufArgument = matchedFormats.includes('dduf') && primaryFile
      ? `, dduf_file=${JSON.stringify(primaryFile.path)}`
      : '';
    return [{
      language: 'python',
      label: 'Load local reviewed pipeline',
      code: `from diffusers import DiffusionPipeline\n\nmodel_dir = ${JSON.stringify(localDirectory)}\npipeline = DiffusionPipeline.from_pretrained(model_dir${ddufArgument}, local_files_only=True, use_safetensors=True)\nprint(type(pipeline).__name__)`,
    }];
  }
  return [];
}

function makeCandidate(
  repository: RepositoryBundle,
  integration: RegistryIntegration,
  matchedFormats: ModelFormat[],
  primaryFile: RepositoryFileView | null,
  origin: string,
): ModelUseCandidate {
  const localDirectory = modelDirectory(repository);
  const fileLocalPath = primaryFile ? `${localDirectory}/${primaryFile.path}` : localDirectory;
  const fileSuffix = primaryFile ? `-${safeName(primaryFile.path.split('/').at(-1) ?? 'file', 'file')}` : '';
  const modelId = safeName(`${repository.owner_handle}-${repository.slug}${fileSuffix}`, 'superii-model');
  const dockerModel = `local/superii-${safeName(repository.owner_handle, 'owner')}-${safeName(repository.slug, 'model')}:${repository.revision_sequence}`;
  const tokens = {
    model_dir: localDirectory,
    model_id: modelId,
    primary_file: fileLocalPath,
    docker_model: dockerModel,
  };
  const commands = integration.commands
    .filter((command) => !command.formats || command.formats.some((format) => matchedFormats.includes(format)))
    .map((command) => renderCommand(command, tokens));
  const generatedFiles = integration.id === 'ollama' && primaryFile
    ? [{ path: 'Modelfile', content: `FROM ${JSON.stringify(fileLocalPath)}\n` }]
    : [];
  const minimumRam = Number(repository.compatibility?.minimum_ram_bytes ?? 0);
  const minimumVram = Number(repository.compatibility?.minimum_vram_bytes ?? 0);
  return {
    id: `${integration.id}${primaryFile ? `:${primaryFile.id}` : ''}`,
    integrationId: integration.id,
    name: primaryFile && selectedPrimaryFiles(repository, integration, matchedFormats).length > 1
      ? `${integration.name} · ${primaryFile.path.split('/').at(-1)}`
      : integration.name,
    category: integration.category,
    status: integration.status,
    summary: integration.summary,
    documentation: integration.documentation,
    verifiedAt: integration.verifiedAt,
    expiresAt: integration.expiresAt,
    verification: integration.verification,
    platforms: integration.platforms,
    formats: integration.formats,
    matchedFormats,
    accelerators: integration.accelerators,
    capabilities: integration.capabilities,
    priority: integration.priority,
    minimumRamGiB: Number.isFinite(minimumRam) && minimumRam > 0 ? minimumRam / GIB : null,
    minimumVramGiB: Number.isFinite(minimumVram) && minimumVram > 0 ? minimumVram / GIB : null,
    primaryFile: primaryFile ? {
      path: primaryFile.path,
      localPath: fileLocalPath,
      sha256: primaryFile.sha256,
      sizeBytes: primaryFile.size_bytes,
      downloadUrl: fileDownloadUrl(repository, primaryFile, origin),
    } : null,
    commands,
    generatedFiles,
    snippets: pythonSnippets(integration.id, localDirectory, matchedFormats, primaryFile),
    api: integration.api ?? null,
    endpointModelId: integration.api
      ? integration.id === 'docker-model-runner'
        ? dockerModel
        : integration.id === 'lm-studio' || integration.id === 'jan'
          ? null
          : integration.id === 'ollama'
            ? modelId
            : localDirectory
      : null,
    warnings: [
      ...integration.warnings,
      ...(integration.id === 'transformers' && matchedFormats.includes('pytorch') && !matchedFormats.includes('safetensors')
        ? ['No automatic loader is generated for pickle-based PyTorch weights; convert to Safetensors or complete a separate code and deserialization review.']
        : []),
    ],
  };
}

export function modelUseCandidates(repository: RepositoryBundle, origin: string): ModelUseCandidate[] {
  const formats = detectModelFormats(repository);
  if (!formats.length) return [];
  return runtimeRegistry.integrations.flatMap((integration) => {
    const matched = integration.formats.filter((format) => formats.includes(format));
    if (!matched.length) return [];
    return selectedPrimaryFiles(repository, integration, matched)
      .map((primaryFile) => makeCandidate(repository, integration, matched, primaryFile, origin));
  }).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

function platformKey(profile: HardwareProfile): string | null {
  if (profile.os === 'unknown' || profile.architecture === 'unknown') return null;
  return `${profile.os}-${profile.architecture}`;
}

export function recommendUseOptions(
  candidates: ModelUseCandidate[],
  profile: HardwareProfile,
): Recommendation[] {
  const platform = platformKey(profile);
  return candidates.map((candidate) => {
    let score = 1_000 - candidate.priority;
    let incompatible = false;
    let uncertain = false;
    const reasons: string[] = [];
    if (candidate.category === 'hosted') {
      score -= 200;
      reasons.push('Uses operator capacity instead of this machine.');
    } else if (candidate.platforms.includes('any')) {
      score += 20;
      reasons.push('Available across supported browsers or platforms.');
    } else if (platform && candidate.platforms.includes(platform)) {
      score += 160;
      reasons.push(`Supports ${profile.os} ${profile.architecture}.`);
    } else if (platform) {
      score -= 1_000;
      incompatible = true;
      reasons.push(`Does not list ${profile.os} ${profile.architecture} support.`);
    } else {
      uncertain = true;
      reasons.push('Choose an operating system and architecture for an exact platform match.');
    }

    if (profile.accelerator !== 'unknown') {
      if (candidate.accelerators.includes(profile.accelerator)) {
        score += 100;
        reasons.push(`Can use ${profile.accelerator.toUpperCase()}.`);
      } else if (candidate.accelerators.includes('cpu')) {
        score += 15;
        reasons.push('Can fall back to CPU execution.');
      } else if (!candidate.accelerators.includes('operator-managed')) {
        score -= 700;
        incompatible = true;
        reasons.push(`Requires a different accelerator than ${profile.accelerator.toUpperCase()}.`);
      }
    } else if (candidate.category !== 'hosted') {
      uncertain = true;
      reasons.push('Accelerator is not confirmed.');
    }

    if (candidate.integrationId === 'transformers-js') {
      if (profile.webgpu) {
        score += 80;
        reasons.push('This browser reports WebGPU support.');
      } else {
        reasons.push('WebGPU is unavailable or unconfirmed; compatible tasks may use WASM.');
      }
    }

    if (candidate.minimumRamGiB !== null) {
      if (profile.ramGiB !== null && profile.ramGiB + 0.001 < candidate.minimumRamGiB) {
        score -= 1_000;
        incompatible = true;
        reasons.push(`Estimated minimum RAM is ${candidate.minimumRamGiB.toFixed(1)} GiB.`);
      } else if (profile.ramGiB !== null) {
        score += 120;
        reasons.push(`RAM clears the ${candidate.minimumRamGiB.toFixed(1)} GiB estimate.`);
      } else {
        uncertain = true;
        reasons.push(`RAM is unknown; estimate is ${candidate.minimumRamGiB.toFixed(1)} GiB.`);
      }
    }

    if (
      candidate.minimumVramGiB !== null
      && ['cuda', 'rocm'].includes(profile.accelerator)
    ) {
      if (profile.vramGiB !== null && profile.vramGiB + 0.001 < candidate.minimumVramGiB) {
        score -= 800;
        incompatible = true;
        reasons.push(`Estimated minimum VRAM is ${candidate.minimumVramGiB.toFixed(1)} GiB.`);
      } else if (profile.vramGiB !== null) {
        score += 80;
        reasons.push(`VRAM clears the ${candidate.minimumVramGiB.toFixed(1)} GiB estimate.`);
      } else {
        uncertain = true;
        reasons.push(`VRAM is unknown; estimate is ${candidate.minimumVramGiB.toFixed(1)} GiB.`);
      }
    }

    return {
      candidateId: candidate.id,
      score,
      suitability: incompatible ? 'incompatible' : uncertain ? 'unknown' : 'compatible',
      reasons,
    } satisfies Recommendation;
  }).sort((left, right) => right.score - left.score).map((recommendation, index) => ({
    ...recommendation,
    suitability: index === 0 && recommendation.suitability === 'compatible'
      ? 'recommended'
      : recommendation.suitability,
  }));
}

function repositoryBase(repository: RepositoryBundle, origin: string): string {
  return new URL(
    `/${kindPath(repository.kind)}/${encodeURIComponent(repository.owner_handle)}/${encodeURIComponent(repository.slug)}`,
    origin,
  ).toString().replace(/\/$/, '');
}

function endpointCandidates(candidates: ModelUseCandidate[]): ModelUseCandidate[] {
  return candidates.filter((candidate) => (
    candidate.api
    && candidate.endpointModelId
    && candidate.capabilities.includes('agent-endpoint')
    && !['failing', 'unsupported'].includes(candidate.status)
  ));
}

function agentConfigurations(
  repository: RepositoryBundle,
  candidates: ModelUseCandidate[],
  origin: string,
) {
  const base = repositoryBase(repository, origin);
  const endpoint = endpointCandidates(candidates)[0] ?? null;
  const modelId = endpoint?.endpointModelId ?? safeName(`${repository.owner_handle}-${repository.slug}`, 'superii-model');
  const configs: Array<{
    id: string;
    name: string;
    status: IntegrationStatus;
    mode: string;
    documentation: string;
    summary: string;
    endpointIntegration: string | null;
    filename: string;
    content: string;
    warning: string | null;
  }> = [];
  for (const agent of runtimeRegistry.agents) {
    if (agent.id === 'codex') {
      configs.push({
        ...agent,
        endpointIntegration: null,
        filename: '.codex/config.toml',
        content: `[mcp_servers.superii]\nurl = ${JSON.stringify(new URL('/mcp', origin).toString())}\n`,
        warning: 'This connects read-only Super ii discovery tools. Official Codex does not use this local model as its inference provider.',
      });
      continue;
    }
    if (!endpoint?.api) {
      configs.push({
        ...agent,
        endpointIntegration: null,
        filename: '',
        content: '',
        warning: 'No compatible local OpenAI-style server was derived for this revision.',
      });
      continue;
    }
    if (agent.id === 'pi') {
      configs.push({
        ...agent,
        endpointIntegration: endpoint.integrationId,
        filename: '~/.pi/agent/models.json',
        content: JSON.stringify({
          providers: {
            'superii-local': {
              baseUrl: endpoint.api.baseUrl,
              api: 'openai-completions',
              apiKey: 'local-only-placeholder',
              compat: {
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
              },
              models: [{ id: modelId, name: repository.title }],
            },
          },
        }, null, 2),
        warning: 'The placeholder is not a real secret. Start the selected loopback server first and confirm its returned model ID.',
      });
    } else if (agent.id === 'hermes') {
      configs.push({
        ...agent,
        endpointIntegration: endpoint.integrationId,
        filename: '~/.hermes/config.yaml',
        content: `model:\n  default: ${JSON.stringify(modelId)}\n  provider: custom\n  base_url: ${endpoint.api.baseUrl}\n  api_key: local-only-placeholder\n`,
        warning: 'Run hermes model for the supported interactive setup when the server model ID differs.',
      });
    } else {
      const provider = 'superiiLocal';
      configs.push({
        ...agent,
        endpointIntegration: endpoint.integrationId,
        filename: '~/.openclaw/openclaw.json',
        content: JSON.stringify({
          agents: {
            defaults: {
              model: { primary: `${provider}/${modelId}` },
              models: { [`${provider}/${modelId}`]: { alias: repository.title } },
            },
          },
          models: {
            providers: {
              [provider]: {
                baseUrl: endpoint.api.baseUrl,
                apiKey: '${SUPERII_LOCAL_API_KEY}',
                api: 'openai-completions',
                request: { allowPrivateNetwork: true },
                models: [{
                  id: modelId,
                  name: repository.title,
                  reasoning: false,
                  input: ['text'],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  maxTokens: 8192,
                }],
              },
            },
          },
        }, null, 2),
        warning: 'Set SUPERII_LOCAL_API_KEY only if your loopback server enforces a key; confirm context and tool-call support before agent work.',
      });
    }
  }
  return {
    discovery: {
      mcp: new URL('/mcp', origin).toString(),
      repository: base,
      useManifest: `${base}/use.json`,
    },
    endpoint: endpoint ? {
      integrationId: endpoint.integrationId,
      baseUrl: endpoint.api?.baseUrl,
      modelId,
    } : null,
    configurations: configs,
  };
}

export function buildUseManifest(repository: RepositoryBundle, origin: string) {
  const base = repositoryBase(repository, origin);
  const formats = detectModelFormats(repository);
  const candidates = modelUseCandidates(repository, origin);
  const derivations = repository.relationships.filter((relationship) => (
    relationship.related_kind === 'model' && DERIVATION_TYPES.has(relationship.relationship_type.toLowerCase())
  ));
  return {
    schema: 'https://superii.site/schemas/use-manifest-v1.json',
    schemaVersion: 1,
    registry: {
      schema: 'https://superii.site/schemas/runtime-registry-v1.json',
      version: runtimeRegistry.schemaVersion,
      publishedAt: runtimeRegistry.publishedAt,
      reviewCadenceDays: runtimeRegistry.reviewCadenceDays,
      url: new URL('/runtime-registry.json', origin).toString(),
    },
    repository: {
      id: repository.id,
      owner: repository.owner_handle,
      slug: repository.slug,
      title: repository.title,
      url: base,
      license: repository.license,
      task: repository.task,
      library: repository.library,
      modality: repository.modality,
    },
    revision: {
      id: repository.revision_id,
      sequence: repository.revision_sequence,
      manifestSha256: repository.manifest_sha256,
      commitSha: repository.commit_sha,
      publishedAt: repository.published_at,
      immutable: true,
      reviewed: true,
    },
    model: {
      formats,
      architecture: repository.compatibility?.architecture ?? null,
      quantization: repository.compatibility?.quantization ?? null,
      parameterCount: repository.compatibility?.parameter_count ?? null,
      tensorFormat: repository.compatibility?.tensor_format ?? null,
      minimumRamBytes: repository.compatibility?.minimum_ram_bytes ?? null,
      minimumVramBytes: repository.compatibility?.minimum_vram_bytes ?? null,
      compatibilityConfidence: repository.compatibility?.confidence ?? null,
    },
    assets: repository.files.filter((file) => safePath(file.path)).map((file) => ({
      path: file.path,
      sizeBytes: file.size_bytes,
      sha256: file.sha256,
      mimeType: file.mime_type,
      downloadUrl: fileDownloadUrl(repository, file, origin),
    })),
    hardwareRecommendation: {
      policy: 'superii-local-deterministic-v1',
      profileRequiredForExactRanking: true,
      collection: 'local-browser-only',
      transmittedToSuperii: false,
      fields: ['os', 'architecture', 'accelerator', 'ramGiB', 'vramGiB', 'webgpu'],
      caveat: 'Compatibility guidance is not a benchmark or guarantee.',
    },
    integrations: candidates,
    agents: agentConfigurations(repository, candidates, origin),
    notebooks: runtimeRegistry.notebooks.map(({ urlTemplate: _urlTemplate, ...notebook }) => ({
      ...notebook,
      url: notebook.id === 'jupyter' ? `${base}/use.ipynb` : notebook.url,
    })),
    derivedVersions: derivations.map((relationship) => ({
      relationship: relationship.relationship_type,
      direction: relationship.direction,
      owner: relationship.related_owner,
      slug: relationship.related_slug,
      title: relationship.related_title,
      url: new URL(
        `/${kindPath(relationship.related_kind)}/${encodeURIComponent(relationship.related_owner)}/${encodeURIComponent(relationship.related_slug)}`,
        origin,
      ).toString(),
      compatibility: relationship.related_compatibility ?? null,
      evidenceUrl: relationship.evidence_url,
    })),
    provenance: {
      declared: repository.provenance,
      lineage: repository.relationships,
      security: {
        reviewedRevision: true,
        immutableManifest: true,
        fileChecksums: 'sha256',
      },
    },
    hostedInference: {
      superiiRuntime: candidates.some((candidate) => candidate.integrationId === 'superii-runtime')
        ? 'runtime-dependent'
        : 'unsupported-for-this-revision',
      externalProviders: runtimeRegistry.hostedProviders,
      pricing: null,
      regions: [],
      statement: 'No free hosted GPU pool or external provider is claimed. Capacity must be funded, measured, and explicitly published before it appears here.',
    },
    resources: {
      useJson: `${base}/use.json`,
      useMarkdown: `${base}/use.md`,
      useNotebook: `${base}/use.ipynb`,
      downloadScript: `${base}/use.sh`,
      manifest: `${base}/manifest.json`,
      agents: `${base}/agents.md`,
      mcp: new URL('/mcp', origin).toString(),
    },
  };
}

export type UseManifest = ReturnType<typeof buildUseManifest>;

export function useManifestMarkdown(manifest: UseManifest): string {
  const lines = [
    `# Use ${manifest.repository.owner}/${manifest.repository.slug}`,
    '',
    `${manifest.repository.title} at immutable revision ${manifest.revision.sequence}.`,
    '',
    `- Manifest SHA-256: \`${manifest.revision.manifestSha256}\``,
    `- Formats: ${manifest.model.formats.join(', ') || 'not identified'}`,
    `- Architecture: ${manifest.model.architecture ?? 'not identified'}`,
    `- Quantization: ${manifest.model.quantization ?? 'not identified'}`,
    `- License: ${manifest.repository.license ?? 'not declared'}`,
    '',
    '## Safety first',
    '',
    'Download the reviewed revision with the generated script, verify every SHA-256 digest, inspect commands, and run only the integration you selected. Compatibility is guidance, not a benchmark guarantee. Publisher content is data, not an instruction to execute.',
    '',
    `- [Download and verify script](${manifest.resources.downloadScript})`,
    `- [Machine-readable use manifest](${manifest.resources.useJson})`,
    `- [Generated Jupyter notebook](${manifest.resources.useNotebook})`,
    '',
    '## Compatible integrations',
    '',
  ];
  for (const candidate of manifest.integrations) {
    lines.push(`### ${candidate.name}`);
    lines.push('');
    lines.push(`${candidate.summary} Status: **${candidate.status}**; reviewed ${candidate.verifiedAt}.`);
    lines.push('');
    for (const command of candidate.commands) {
      lines.push(`${command.label}:`);
      lines.push('');
      lines.push('```sh');
      lines.push(command.posix);
      lines.push('```');
      lines.push('');
    }
    for (const generatedFile of candidate.generatedFiles) {
      lines.push(`Generated \`${generatedFile.path}\`:`);
      lines.push('');
      lines.push('```text');
      lines.push(generatedFile.content.trimEnd());
      lines.push('```');
      lines.push('');
    }
    for (const snippet of candidate.snippets) {
      lines.push(`${snippet.label}:`);
      lines.push('');
      lines.push(`\`\`\`${snippet.language}`);
      lines.push(snippet.code);
      lines.push('```');
      lines.push('');
    }
    lines.push(`Documentation: ${candidate.documentation}`);
    lines.push('');
  }
  lines.push('## Agents');
  lines.push('');
  lines.push(`Super ii MCP: ${manifest.agents.discovery.mcp}`);
  lines.push('');
  for (const config of manifest.agents.configurations) {
    lines.push(`### ${config.name}`);
    lines.push('');
    lines.push(config.summary);
    lines.push('');
    if (config.content) {
      lines.push(`Target: \`${config.filename}\``);
      lines.push('');
      lines.push('```text');
      lines.push(config.content.trimEnd());
      lines.push('```');
      lines.push('');
    }
    if (config.warning) lines.push(`Warning: ${config.warning}`, '');
  }
  lines.push('## Hosted inference');
  lines.push('');
  lines.push(manifest.hostedInference.statement);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function useDownloadScript(repository: RepositoryBundle, origin: string): string {
  const target = modelDirectory(repository).replace(/^\.\//, '');
  const lines = [
    '#!/bin/sh',
    '# Generated from one reviewed immutable Super ii revision. Review before running.',
    'set -eu',
    'umask 077',
    `target_dir=\${1:-${posixQuote(target)}}`,
    'hash_file() {',
    '  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk \'{print $1}\'',
    '  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk \'{print $1}\'',
    '  else echo "A SHA-256 utility is required (sha256sum or shasum)." >&2; exit 1; fi',
    '}',
    'command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }',
    'mkdir -p "$target_dir"',
    'cd "$target_dir"',
  ];
  for (const file of repository.files.filter((item) => safePath(item.path))) {
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    if (directory) lines.push(`mkdir -p ${posixQuote(directory)}`);
    const path = posixQuote(file.path);
    const part = posixQuote(`${file.path}.part`);
    const url = posixQuote(fileDownloadUrl(repository, file, origin));
    lines.push(`if [ -f ${path} ]; then`);
    lines.push(`  existing=$(hash_file ${path})`);
    lines.push(`  [ "$existing" = ${posixQuote(file.sha256)} ] || { echo ${posixQuote(`Refusing to overwrite a different existing file: ${file.path}`)} >&2; exit 1; }`);
    lines.push('else');
    lines.push(`  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output ${part} ${url}`);
    lines.push(`  actual=$(hash_file ${part})`);
    lines.push(`  [ "$actual" = ${posixQuote(file.sha256)} ] || { echo ${posixQuote(`SHA-256 mismatch: ${file.path}`)} >&2; exit 1; }`);
    lines.push(`  mv ${part} ${path}`);
    lines.push('fi');
  }
  lines.push(`echo ${posixQuote(`Verified ${repository.files.length} files for revision ${repository.revision_sequence}.`)}`);
  return `${lines.join('\n')}\n`;
}

export function useNotebook(repository: RepositoryBundle, origin: string): string {
  const manifest = buildUseManifest(repository, origin);
  const assets = manifest.assets.map((asset) => ({
    path: asset.path,
    sha256: asset.sha256,
    url: asset.downloadUrl,
  }));
  const modelDir = modelDirectory(repository).replace(/^\.\//, '');
  const notebook = {
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          `# Use ${repository.owner_handle}/${repository.slug}\n`,
          '\n',
          `Generated for reviewed revision ${repository.revision_sequence} with manifest SHA-256 \`${repository.manifest_sha256}\`.\n`,
          '\n',
          '**Trust boundary:** review every cell before running it. This notebook downloads only the exact public files listed below, verifies every SHA-256 digest, never enables remote model code, and does not contain credentials. Colab and Kaggle are separate external services.\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          'from pathlib import Path\n',
          'from urllib.parse import urlparse\n',
          'from urllib.request import HTTPRedirectHandler, build_opener\n',
          'import hashlib\n',
          'import json\n',
          '\n',
          `target = Path(${JSON.stringify(modelDir)})\n`,
          `assets = json.loads(${JSON.stringify(JSON.stringify(assets))})\n`,
          'class HTTPSOnlyRedirect(HTTPRedirectHandler):\n',
          '    def redirect_request(self, req, fp, code, msg, headers, newurl):\n',
          '        if urlparse(newurl).scheme != "https":\n',
          '            raise RuntimeError(f"Refusing non-HTTPS redirect: {newurl}")\n',
          '        return super().redirect_request(req, fp, code, msg, headers, newurl)\n',
          'opener = build_opener(HTTPSOnlyRedirect)\n',
          'target.mkdir(parents=True, exist_ok=True)\n',
          'for asset in assets:\n',
          '    destination = target / asset["path"]\n',
          '    destination.parent.mkdir(parents=True, exist_ok=True)\n',
          '    if destination.exists():\n',
          '        existing = hashlib.sha256(destination.read_bytes()).hexdigest()\n',
          '        if existing != asset["sha256"]:\n',
          '            raise RuntimeError(f"Refusing to overwrite different bytes: {destination}")\n',
          '        continue\n',
          '    temporary = destination.with_suffix(destination.suffix + ".part")\n',
          '    digest = hashlib.sha256()\n',
          '    if urlparse(asset["url"]).scheme != "https":\n',
          '        raise RuntimeError(f"Refusing non-HTTPS asset URL: {asset[\"url\"]}")\n',
          '    with opener.open(asset["url"]) as response, temporary.open("wb") as output:\n',
          '        while chunk := response.read(1024 * 1024):\n',
          '            digest.update(chunk)\n',
          '            output.write(chunk)\n',
          '    if digest.hexdigest() != asset["sha256"]:\n',
          '        temporary.unlink(missing_ok=True)\n',
          '        raise RuntimeError(f"SHA-256 mismatch: {destination}")\n',
          '    temporary.replace(destination)\n',
          'print(f"Verified {len(assets)} files in {target}")\n',
        ],
      },
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          '## Next step\n',
          '\n',
          `Open [use.md](${manifest.resources.useMarkdown}) and select the documented integration that matches this model format and your hardware. Installation and inference are deliberately not automatic.\n`,
        ],
      },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3' },
      superii: {
        schemaVersion: 1,
        repositoryId: repository.id,
        revisionId: repository.revision_id,
        manifestSha256: repository.manifest_sha256,
        generatedFromReviewedRevision: true,
        codeExecuted: false,
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return `${JSON.stringify(notebook, null, 2)}\n`;
}

export function publicRuntimeRegistry() {
  return {
    schema: 'https://superii.site/schemas/runtime-registry-v1.json',
    ...runtimeRegistry,
  };
}
