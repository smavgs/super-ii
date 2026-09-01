import { z } from 'zod';
import { repositoryDocument } from './agent-resources';
import { searchCatalog, type CatalogFilters, type RepositoryKind } from './catalog';
import { getPublicRepository, type RepositoryBundle } from './repository';
import { systemState } from './system-state';

const catalogArguments = z.object({
  kind: z.enum(['model', 'dataset', 'space']),
  query: z.string().trim().max(300).optional(),
  task: z.string().trim().max(120).optional(),
  library: z.string().trim().max(120).optional(),
  license: z.string().trim().max(120).optional(),
  modality: z.string().trim().max(120).optional(),
  author: z.string().trim().max(120).optional(),
  max_size_bytes: z.number().int().nonnegative().optional(),
  updated_after: z.iso.date().optional(),
  hardware: z.enum(['apple-silicon', 'nvidia', 'amd', 'cpu', 'browser', 'llama-cpp']).optional(),
  operating_system: z.enum(['macos', 'linux', 'windows', 'browser']).optional(),
  available_ram_bytes: z.number().int().nonnegative().optional(),
  available_vram_bytes: z.number().int().nonnegative().optional(),
  sort: z.enum(['relevance', 'trending', 'downloads', 'likes', 'updated']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

const repositoryArguments = z.object({
  kind: z.enum(['model', 'dataset', 'space']),
  owner: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(96),
}).strict();

const downloadArguments = repositoryArguments.extend({
  path: z.string().trim().min(1).max(1024),
}).strict();

const skillRequest = z.discriminatedUnion('skillId', [
  z.object({ skillId: z.literal('search-public-catalog'), arguments: catalogArguments }).strict(),
  z.object({ skillId: z.literal('inspect-public-repository'), arguments: repositoryArguments }).strict(),
  z.object({ skillId: z.literal('resolve-verified-download'), arguments: downloadArguments }).strict(),
  z.object({ skillId: z.literal('read-system-state'), arguments: z.object({}).strict().default({}) }).strict(),
]);

const partSchema = z.object({
  text: z.string().max(20_000).optional(),
  data: z.unknown().optional(),
  mediaType: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((part, context) => {
  if ((part.text === undefined ? 0 : 1) + (part.data === undefined ? 0 : 1) !== 1) {
    context.addIssue({ code: 'custom', message: 'each part must contain exactly one of text or data' });
  }
});

export const a2aMessageRequestSchema = z.object({
  message: z.object({
    messageId: z.string().trim().min(1).max(200),
    role: z.literal('ROLE_USER'),
    parts: z.array(partSchema).min(1).max(8),
    contextId: z.string().trim().min(1).max(200).optional(),
    taskId: z.string().trim().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  configuration: z.object({
    acceptedOutputModes: z.array(z.string().max(200)).max(8).optional(),
    historyLength: z.number().int().min(0).max(10).optional(),
  }).strict().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type A2AExecution =
  | { ok: true; skillId: string; output: unknown }
  | { ok: false; status: 'input-required' | 'rejected' | 'failed'; message: string };

function requestedSkill(parts: Array<z.infer<typeof partSchema>>) {
  for (const part of parts) {
    if (part.data !== undefined) return skillRequest.safeParse(part.data);
    if (part.text) {
      try {
        return skillRequest.safeParse(JSON.parse(part.text));
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function repositoryOrFailure(
  locals: App.Locals,
  kind: RepositoryKind,
  owner: string,
  slug: string,
): Promise<RepositoryBundle | A2AExecution> {
  const found = await getPublicRepository(locals, kind, owner, slug);
  if (found.repository) return found.repository;
  if (found.state === 'error') return { ok: false, status: 'failed', message: 'Public repository service is unavailable.' };
  return { ok: false, status: 'rejected', message: 'Reviewed public repository not found.' };
}

function isExecution(value: RepositoryBundle | A2AExecution): value is A2AExecution {
  return 'ok' in value;
}

export async function executeA2APublicSkill(
  locals: App.Locals,
  origin: string,
  parts: Array<z.infer<typeof partSchema>>,
): Promise<A2AExecution> {
  const parsed = requestedSkill(parts);
  if (!parsed) {
    return {
      ok: false,
      status: 'input-required',
      message: 'Send one structured data part with skillId and arguments. Read /.well-known/agent-card.json for supported skills.',
    };
  }
  if (!parsed.success) {
    return {
      ok: false,
      status: 'input-required',
      message: `The requested public skill is invalid: ${parsed.error.issues[0]?.message ?? 'invalid arguments'}.`,
    };
  }

  const request = parsed.data;
  if (request.skillId === 'read-system-state') {
    return { ok: true, skillId: request.skillId, output: systemState };
  }

  if (request.skillId === 'search-public-catalog') {
    const input = request.arguments;
    const filters: CatalogFilters = {
      query: input.query,
      task: input.task,
      library: input.library,
      license: input.license,
      modality: input.modality,
      author: input.author,
      maxSizeBytes: input.max_size_bytes,
      updatedAfter: input.updated_after,
      hardware: input.hardware,
      operatingSystem: input.operating_system,
      maxRamBytes: input.available_ram_bytes,
      maxVramBytes: input.available_vram_bytes,
      sort: input.sort,
    };
    const found = await searchCatalog(locals, input.kind, filters, input.limit, 0);
    if (found.state === 'error') return { ok: false, status: 'failed', message: 'Public search is temporarily unavailable.' };
    if (found.state === 'unconfigured') return { ok: false, status: 'failed', message: 'Public search is not configured on this deployment.' };
    return {
      ok: true,
      skillId: request.skillId,
      output: { state: 'ok', count: found.items.length, repositories: found.items },
    };
  }

  const input = request.arguments;
  const repository = await repositoryOrFailure(locals, input.kind, input.owner, input.slug);
  if (isExecution(repository)) return repository;

  if (request.skillId === 'inspect-public-repository') {
    const document = repositoryDocument(repository, origin);
    return {
      ok: true,
      skillId: request.skillId,
      output: {
        repository: document.repository,
        revision: document.revision,
        compatibility: document.compatibility,
        provenance: document.provenance,
        lineage: document.lineage,
        releases: document.releases,
        tags: document.tags,
        analyses: document.analyses,
        community: document.community,
        representations: document.representations,
      },
    };
  }

  if (request.skillId !== 'resolve-verified-download') {
    return { ok: false, status: 'failed', message: 'The requested public skill could not be routed.' };
  }
  const downloadInput = request.arguments;
  const file = repository.files.find((candidate) => candidate.path === downloadInput.path);
  if (!file) return { ok: false, status: 'rejected', message: 'Reviewed public file not found.' };
  return {
    ok: true,
    skillId: request.skillId,
    output: {
      repository_id: repository.id,
      revision_id: repository.revision_id,
      manifest_sha256: repository.manifest_sha256,
      path: file.path,
      size_bytes: file.size_bytes,
      mime_type: file.mime_type,
      sha256: file.sha256,
      download_url: new URL(`/api/repositories/${repository.id}/files/${file.id}`, origin).toString(),
      execute: false,
      verify_after_download: true,
    },
  };
}

function stateFor(execution: A2AExecution): string {
  if (execution.ok) return 'TASK_STATE_COMPLETED';
  if (execution.status === 'input-required') return 'TASK_STATE_INPUT_REQUIRED';
  if (execution.status === 'rejected') return 'TASK_STATE_REJECTED';
  return 'TASK_STATE_FAILED';
}

export function a2aTaskResponse(
  execution: A2AExecution,
  requestMessage: z.infer<typeof a2aMessageRequestSchema>['message'],
) {
  const taskId = crypto.randomUUID();
  const contextId = requestMessage.contextId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  if (!execution.ok) {
    return {
      task: {
        id: taskId,
        contextId,
        status: {
          state: stateFor(execution),
          timestamp,
          message: {
            messageId: crypto.randomUUID(),
            taskId,
            contextId,
            role: 'ROLE_AGENT',
            parts: [{ text: execution.message, mediaType: 'text/plain' }],
          },
        },
        history: [requestMessage],
      },
    };
  }

  const serialized = JSON.stringify(execution.output);
  if (serialized.length > 220_000) {
    return a2aTaskResponse({ ok: false, status: 'failed', message: 'The result exceeded the bounded A2A response size.' }, requestMessage);
  }
  return {
    task: {
      id: taskId,
      contextId,
      status: { state: 'TASK_STATE_COMPLETED', timestamp },
      artifacts: [{
        artifactId: crypto.randomUUID(),
        name: execution.skillId,
        description: 'Bounded read-only result from reviewed public Super ii data.',
        parts: [{ data: execution.output, mediaType: 'application/json' }],
        metadata: { readOnly: true, executedRepositoryCode: false },
      }],
      history: [requestMessage],
      metadata: { skillId: execution.skillId, public: true, readOnly: true },
    },
  };
}
