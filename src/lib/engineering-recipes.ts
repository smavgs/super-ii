import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { projectFiles } from './recipe-templates.ts';

const immutable = z.string().regex(/^[a-f0-9]{64}$/);
const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
const path = z.string().min(1).max(1024).refine(value =>
  !/[\\\x00-\x1f:]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), 'Use relative file paths');
const input = z.object({ repository: repositoryName, revision: immutable, files: z.array(path).min(1).max(1000).optional() }).strict();
export const recipeRequest = z.object({
  outcome: z.enum(['rag', 'api', 'sft']), generator: input,
  embedding: input.nullish(), dataset: input.nullish(),
  accelerator: z.enum(['cpu', 'metal']).default('cpu'),
  runtime: z.enum(['auto', 'llama.cpp', 'transformers', 'mlx']).default('auto'),
  configuration: z.object({
    chunk_size: z.number().int().min(64).max(4096).default(256),
    chunk_overlap: z.number().int().min(0).max(2048).default(32),
    top_k: z.number().int().min(1).max(50).default(4),
    context_size: z.number().int().min(512).max(131072).default(4096),
    max_tokens: z.number().int().min(1).max(4096).default(256),
    min_score: z.number().min(-1).max(1).default(0.2),
    embedding_max_tokens: z.number().int().min(32).max(4096).default(512),
    query_prefix: z.string().max(200).default(''), document_prefix: z.string().max(200).default(''),
    seed: z.number().int().min(0).max(2147483647).default(42),
    max_steps: z.number().int().min(1).max(100000).default(20),
    batch_size: z.number().int().min(1).max(128).default(1),
    gradient_accumulation_steps: z.number().int().min(1).max(1024).default(4),
    sequence_length: z.number().int().min(32).max(32768).default(256),
    lora_rank: z.number().int().min(1).max(256).default(8),
    learning_rate: z.number().min(0.000001).max(0.01).default(0.0002),
    adapter: z.literal('lora').default('lora'),
    framework: z.enum(['python', 'langchain']).default('python'),
    ui: z.enum(['none', 'gradio']).default('none'), observability: z.boolean().default(false),
  }).strict().prefault({}),
}).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.configuration.chunk_overlap >= value.configuration.chunk_size) invalid('Overlap must be smaller than chunk size');
  if (value.configuration.max_tokens + 256 >= value.configuration.context_size) invalid('Reserve context for the input and answer');
  if (value.outcome === 'rag' && !value.embedding) invalid('RAG needs an embedding model and immutable revision');
  if (value.outcome === 'sft' && !value.dataset) invalid('SFT needs a dataset and immutable revision');
  if (value.outcome === 'sft' && (value.accelerator !== 'cpu' || !['auto', 'transformers'].includes(value.runtime))) invalid('The verified SFT recipe uses Transformers on CPU');
  if (value.outcome === 'sft' && (value.configuration.framework !== 'python' || value.configuration.ui !== 'none')) invalid('Framework and UI exports are available for inference projects');
  if (value.runtime === 'mlx' && value.accelerator !== 'metal') invalid('MLX needs an Apple target');
});
export type RecipeRequest = z.infer<typeof recipeRequest>;
export type InputRequest = z.infer<typeof input>;
export type SdkInput = {
  repository: { kind?: string; owner: string; slug: string; task?: string };
  revision: { commit_sha: string; manifest_sha256: string };
  compatibility?: { architecture?: string; mlx_compatible?: boolean } | null;
  files: { path: string; size_bytes: number; sha256: string }[];
};
export const dependencies = {
  'superii-sdk': '0.2.0', torch: '2.14.0', transformers: '5.16.1', accelerate: '1.14.0',
  'faiss-cpu': '1.15.0', numpy: '2.5.2', peft: '0.20.0', trl: '1.12.0', datasets: '5.0.1',
  fastapi: '0.141.1', uvicorn: '0.52.4', 'prometheus-client': '0.26.0', safetensors: '0.8.0',
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const checksum = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)));
const encoders = new Set(['bert', 'roberta', 'distilbert', 'xlm-roberta']);
const generators = new Set(['llama', 'mistral', 'qwen2', 'qwen3', 'gemma', 'gemma2', 'gemma3_text', 'phi3', 'gpt2', 'gpt_neox', 'opt', 'falcon', 'stablelm', 'olmo', 'olmo2']);

function artifact(role: 'generator' | 'embedding' | 'dataset', selected: InputRequest, source: SdkInput, request: RecipeRequest) {
  const kind = role === 'dataset' ? 'dataset' : 'model';
  if ((source.repository.kind ?? 'model') !== kind || `${source.repository.owner}/${source.repository.slug}`.toLowerCase() !== selected.repository.toLowerCase() || source.revision.commit_sha !== selected.revision || !/^[a-f0-9]{64}$/.test(source.revision.manifest_sha256)) throw new Error('The resolved source does not match the requested immutable input');
  const names = source.files.map(file => file.path);
  let files = selected.files ? [...selected.files] : names.filter(name => role === 'dataset'
    ? /\.(jsonl|csv|txt|md)$/.test(name) && !/(^|\/)(readme|license)(\.|$)/i.test(name)
    : /\.(safetensors|json|model|txt|tiktoken|gguf)$/.test(name));
  if (!files.length || files.some(name => !names.includes(name) || !path.safeParse(name).success)) throw new Error(`Select available ${role} files`);
  const architecture = source.compatibility?.architecture?.toLowerCase() ?? '';
  if (role === 'dataset' && request.outcome === 'sft' && !files.some(name => name.endsWith('.jsonl'))) throw new Error('SFT requires a JSONL dataset');
  if (role === 'embedding' && (!encoders.has(architecture) || !files.includes('config.json') || !files.some(name => name.endsWith('.safetensors')))) throw new Error('Select a BERT, RoBERTa, DistilBERT or XLM-R safetensors encoder with mean pooling');
  if (role === 'generator') {
    const gguf = files.filter(name => name.endsWith('.gguf') && !/-\d{5}-of-\d{5}\.gguf$/.test(name));
    const useGguf = request.outcome !== 'sft' && ['auto', 'llama.cpp'].includes(request.runtime) && gguf.length > 0;
    if (useGguf) files = gguf;
    else if (!generators.has(architecture) || !files.includes('config.json') || !files.some(name => name.endsWith('.safetensors'))) throw new Error('This template needs a supported text-generation architecture and safetensors, or a complete GGUF file');
    if (request.outcome === 'sft' && source.compatibility?.mlx_compatible) throw new Error('SFT requires Transformers training weights');
    if (request.runtime === 'mlx' && !source.compatibility?.mlx_compatible) throw new Error('Select existing MLX-compatible weights');
  }
  return { kind, repository: `${source.repository.owner}/${source.repository.slug}`, revision: selected.revision, manifest_sha256: source.revision.manifest_sha256, files: [...new Set(files)].sort() };
}

export function generateProject(raw: unknown, resolved: { generator: SdkInput; embedding?: SdkInput; dataset?: SdkInput }) {
  const request = recipeRequest.parse(raw);
  const value = {
    schema: 'https://superii.site/schemas/superii-recipe-v1.json', recipe_version: 1,
    outcome: request.outcome, template: { id: `superii-${request.outcome}`, version: '1.0.0' },
    inputs: {
      generator: artifact('generator', request.generator, resolved.generator, request),
      embedding: request.embedding && resolved.embedding ? artifact('embedding', request.embedding, resolved.embedding, request) : null,
      dataset: request.dataset && resolved.dataset ? artifact('dataset', request.dataset, resolved.dataset, request) : null,
    },
    target: { accelerator: request.accelerator, python: '3.12', runtime: request.runtime },
    configuration: request.configuration, dependencies,
    verification: { scope: 'template-fixture-tests', model_quality: 'not-established', hardware: request.outcome === 'sft' ? ['cpu'] : ['cpu', 'metal'] },
  };
  if ((request.embedding && !value.inputs.embedding) || (request.dataset && !value.inputs.dataset)) throw new Error('A required source could not be resolved');
  const recipe = { ...value, recipe_sha256: checksum(canonical(value)) };
  const files = projectFiles(recipe);
  const manifest = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: checksum(content), size_bytes: new TextEncoder().encode(content).length }]));
  return { recipe, files, manifest, filename: `superii-${request.outcome}-${recipe.recipe_sha256.slice(0, 12)}.zip` };
}
