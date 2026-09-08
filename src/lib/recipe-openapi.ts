import { z } from 'zod';
import { recipeRequest } from './engineering-recipes';

const repositoryId = { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const branch = { name: 'branch', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } };
const sourceTokens = ['generator', 'embedding', 'dataset'].map(role => ({
  name: `x-superii-${role}-token`, in: 'header', required: false,
  description: `Optional current repository:read credential for the private ${role} input. Sent only to the canonical Super ii origin. Never save it in recipe files.`,
  schema: { type: 'string', pattern: '^sii_(?:agent_)?[a-z0-9]{40,128}$' },
}));
const protectedAccess = [{ repositoryBearer: [] }, { agentBearer: [] }, { clerkSession: [] }];
const recipe = { $ref: 'https://superii.site/schemas/superii-recipe-v1.json' };
const run = { $ref: 'https://superii.site/schemas/superii-run-v1.json' };
const requestSchema = {
  ...z.toJSONSchema(recipeRequest, { io: 'input', unrepresentable: 'any' }),
  description: 'File selections must contain safe relative paths: no backslashes, control characters, colons, empty segments, dot segments, or segments ending in a dot or space. The server additionally requires chunk_overlap < chunk_size and max_tokens + 256 < context_size, including defaults, and checks the resolved model architecture and files.',
  allOf: [
    { if: { properties: { outcome: { const: 'rag' } }, required: ['outcome'] }, then: { required: ['embedding'], properties: { embedding: { type: 'object' } } } },
    { if: { properties: { outcome: { const: 'sft' } }, required: ['outcome'] }, then: {
      required: ['dataset'], properties: {
        dataset: { type: 'object' }, accelerator: { const: 'cpu' }, runtime: { enum: ['auto', 'transformers'] },
        configuration: { properties: { framework: { const: 'python' }, ui: { const: 'none' } } },
      },
    } },
    { if: { properties: { runtime: { const: 'mlx' } }, required: ['runtime'] }, then: { required: ['accelerator'], properties: { accelerator: { const: 'metal' } } } },
  ],
};
export const recipeApiPaths = {
  '/api/sdk/datasets/{owner}/{slug}': {
    get: {
      tags: ['Python SDK'],
      operationId: 'getSdkDatasetManifest', summary: 'Acquire an immutable published dataset manifest',
      description: 'Uses the same fresh read authorization, immutable commit, file hash and Ed25519 publication checks as model acquisition. Unavailable and unauthorized repositories both return 404.',
      security: [{}, ...protectedAccess],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
        { name: 'slug', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
        { name: 'revision', in: 'query', required: false, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
      ],
      responses: {
        '200': { description: 'Dataset files and signed publication evidence', content: { 'application/json': { schema: { $ref: 'https://superii.site/schemas/sdk-manifest-v2.json' } } } },
        '404': { description: 'Published dataset unavailable to this caller' },
        '422': { description: 'Invalid immutable revision' },
        '503': { description: 'Metadata service unavailable' },
      },
    },
  },
  '/api/recipes/generate': {
    post: {
      tags: ['Build & Ship'],
      operationId: 'generateEngineeringProject', summary: 'Generate a local RAG, model API or LoRA project',
      description: 'Resolves published immutable model and dataset inputs, then returns text files and SHA-256 checksums. This does not execute code, start training, deploy or publish anything. Maximum JSON request: 16 KiB. Browser Origin must match; ordinary software clients may omit it. SFT uses CPU Transformers. NVIDIA exports require explicit opt-in and have no GPU execution evidence.',
      security: [{}, ...protectedAccess], parameters: sourceTokens,
      requestBody: { required: true, content: { 'application/json': { schema: requestSchema } } },
      responses: {
        '200': { description: 'Recipe, project files and verified download metadata', content: { 'application/json': { schema: {
          type: 'object', required: ['recipe', 'files', 'manifest', 'filename'], properties: {
            recipe, files: { type: 'object', additionalProperties: { type: 'string' } },
            manifest: { type: 'object', additionalProperties: { type: 'object', required: ['sha256', 'size_bytes'], properties: { sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, size_bytes: { type: 'integer', minimum: 0 } } } },
            filename: { type: 'string' },
          },
        } } } },
        '400': { description: 'Malformed JSON object or Content-Length' },
        '403': { description: 'Invalid browser origin or denied input access' },
        '404': { description: 'An input is unavailable to this caller' },
        '413': { description: 'Request exceeds 16 KiB' },
        '415': { description: 'Content-Type must be application/json' },
        '422': { description: 'Invalid or unsupported recipe configuration' },
        '429': { $ref: '#/components/responses/RateLimited' },
        '503': { description: 'Recipe service unavailable' },
      },
    },
  },
  '/api/repositories/{repositoryId}/recipe': {
    get: {
      tags: ['Build & Ship'],
      operationId: 'getRecipePublicationDestination', summary: 'Inspect the selected destination revision and clean uploaded files',
      description: 'Requires current repository:read authority. Used for publication readback and safe reuse of matching files.',
      security: protectedAccess, parameters: [repositoryId, branch],
      responses: { '200': { description: 'Revision, branch, status and clean file hashes' }, '401': { description: 'Authentication required' }, '403': { description: 'Repository read authority required' }, '404': { description: 'Destination unavailable' }, '503': { description: 'Metadata service unavailable' } },
    },
    post: {
      tags: ['Build & Ship'],
      operationId: 'attachRecipeLineage', summary: 'Attach reported training lineage to an editable model revision',
      description: 'Requires repository:commit authority, exact uploaded recipe/run/artifact hashes, and read access to the published base and dataset. Maximum JSON request: 1 MiB. Browser sessions require the same origin. Records fine-tuned-from and trained-on relationships. Reported metrics never bypass independent publication policy.',
      security: protectedAccess, parameters: [repositoryId, branch, ...sourceTokens.filter(p => p.name !== 'x-superii-embedding-token')],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['recipe', 'run'], properties: { recipe, run } } } } },
      responses: { '200': { description: 'Reported recipe lineage attached; publication still requires central policy' }, '400': { description: 'Malformed JSON object or Content-Length' }, '401': { description: 'Authentication required' }, '403': { description: 'Commit authority or same origin required' }, '404': { description: 'Destination or source input unavailable' }, '409': { description: 'An editable model revision is required' }, '413': { description: 'Request exceeds 1 MiB' }, '415': { description: 'Content-Type must be application/json' }, '422': { description: 'Recipe/run references or uploaded artifact hashes differ' }, '503': { description: 'Lineage service unavailable' } },
    },
  },
};
