#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createServer } from 'vite';


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@': path.join(root, 'src') } },
});

try {
  const useModel = await vite.ssrLoadModule('/src/lib/use-model.ts');
  const resources = await vite.ssrLoadModule('/src/lib/agent-resources.ts');
  const checksum = 'a'.repeat(64);
  const repository = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'model',
    owner_handle: 'release-check',
    slug: 'quoted-model',
    title: 'Quoted model fixture',
    summary: 'In-memory only; never inserted or published.',
    visibility: 'public',
    license: 'apache-2.0',
    task: 'text-generation',
    library: 'llama.cpp',
    modality: 'text',
    total_size_bytes: '4096',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision_sequence: 1,
    manifest_sha256: 'b'.repeat(64),
    commit_sha: 'c'.repeat(64),
    published_at: '2026-08-31T00:00:00.000Z',
    likes_count: 0,
    watchers_count: 0,
    downloads_count: 0,
    card_markdown: '',
    provenance: {},
    files: [{
      id: '33333333-3333-4333-8333-333333333333',
      path: "weights/model's q4.gguf",
      size_bytes: '4096',
      sha256: checksum,
      mime_type: 'application/octet-stream',
    }],
    folders: [],
    versions: [],
    releases: [],
    tags: [],
    discussions: [],
    analyses: [],
    relationships: [{
      direction: 'outgoing',
      relationship_type: 'quantized-from',
      related_kind: 'model',
      related_owner: 'upstream',
      related_slug: 'base-model',
      related_title: 'Base model',
      related_compatibility: null,
      evidence_url: null,
    }],
    related: [],
    compatibility: {
      architecture: 'llama',
      parameter_count: '1000000000',
      quantization: 'Q4_K_M',
      tensor_format: 'gguf',
      model_size_bytes: '4096',
      minimum_ram_bytes: String(4 * 1024 ** 3),
      minimum_vram_bytes: '0',
      cpu_compatible: true,
      cuda_compatible: true,
      rocm_compatible: true,
      metal_compatible: true,
      mlx_compatible: false,
      llama_cpp_compatible: true,
      browser_compatible: false,
      confidence: 'derived',
      evidence: {},
    },
  };

  const origin = 'https://superii.site';
  const manifest = useModel.buildUseManifest(repository, origin);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  const registrySchema = JSON.parse(await readFile(path.join(root, 'public/schemas/runtime-registry-v1.json'), 'utf8'));
  const useSchema = JSON.parse(await readFile(path.join(root, 'public/schemas/use-manifest-v1.json'), 'utf8'));
  const validateRegistry = ajv.compile(registrySchema);
  assert.equal(
    validateRegistry(useModel.publicRuntimeRegistry()),
    true,
    ajv.errorsText(validateRegistry.errors, { separator: '\n' }),
  );
  const validateManifest = ajv.compile(useSchema);
  assert.equal(
    validateManifest(manifest),
    true,
    ajv.errorsText(validateManifest.errors, { separator: '\n' }),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.hardwareRecommendation.transmittedToSuperii, false);
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].sha256, checksum);
  assert.equal(manifest.hostedInference.externalProviders.length, 0);
  assert.equal(manifest.derivedVersions[0].relationship, 'quantized-from');
  assert.ok(manifest.integrations.some((candidate) => candidate.integrationId === 'llama-cpp'));
  assert.ok(manifest.integrations.some((candidate) => candidate.integrationId === 'ollama'));
  assert.ok(manifest.integrations.some((candidate) => candidate.integrationId === 'docker-model-runner'));
  const ollamaCandidate = manifest.integrations.find((candidate) => candidate.integrationId === 'ollama');
  assert.equal(manifest.agents.endpoint.modelId, ollamaCandidate.endpointModelId);
  const openClawConfig = manifest.agents.configurations.find((config) => config.id === 'openclaw');
  assert.match(openClawConfig.content, /"allowPrivateNetwork": true/);

  const ddufRepository = {
    ...repository,
    slug: 'dduf-model',
    files: [{ ...repository.files[0], path: 'pipeline/model.dduf' }],
    compatibility: { ...repository.compatibility, tensor_format: 'dduf', quantization: null },
  };
  const ddufManifest = useModel.buildUseManifest(ddufRepository, origin);
  const dockerDduf = ddufManifest.integrations.find((candidate) => candidate.integrationId === 'docker-model-runner');
  const diffusersDduf = ddufManifest.integrations.find((candidate) => candidate.integrationId === 'diffusers');
  assert.match(dockerDduf.commands.find((command) => command.id === 'package-dduf').posix, /--dduf/);
  assert.match(diffusersDduf.snippets[0].code, /dduf_file=/);

  const pytorchRepository = {
    ...repository,
    slug: 'pytorch-model',
    files: [{ ...repository.files[0], path: 'pytorch_model.bin' }],
    compatibility: { ...repository.compatibility, tensor_format: 'pytorch', quantization: null },
  };
  const pytorchCandidate = useModel.buildUseManifest(pytorchRepository, origin).integrations
    .find((candidate) => candidate.integrationId === 'transformers');
  assert.equal(pytorchCandidate.snippets.length, 0);
  assert.ok(pytorchCandidate.warnings.some((warning) => warning.includes('deserialization review')));

  const profile = {
    os: 'macos',
    architecture: 'arm64',
    accelerator: 'metal',
    ramGiB: 16,
    vramGiB: null,
    webgpu: true,
  };
  const ranking = useModel.recommendUseOptions(manifest.integrations, profile);
  assert.deepEqual(ranking, useModel.recommendUseOptions(manifest.integrations, profile));
  assert.equal(ranking[0].suitability, 'recommended');

  const shell = useModel.useDownloadScript(repository, origin);
  assert.match(shell, /--proto-redir '=https'/);
  assert.doesNotMatch(shell, /curl\s*\|\s*sh/i);
  const shellCheck = spawnSync('sh', ['-n'], { input: shell, encoding: 'utf8' });
  assert.equal(shellCheck.status, 0, shellCheck.stderr);

  const notebook = JSON.parse(useModel.useNotebook(repository, origin));
  assert.equal(notebook.nbformat, 4);
  assert.equal(notebook.metadata.superii.codeExecuted, false);
  assert.match(JSON.stringify(notebook), /HTTPSOnlyRedirect/);

  for (const representation of ['use.json', 'use.md', 'use.ipynb', 'use.sh']) {
    const response = resources.repositoryRepresentationResponse(repository, representation, origin);
    assert.ok(response instanceof Response, `${representation} response is missing`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }

  console.log(`OK: generated and checked Use Manifest, deterministic ranking, 4 representations, ${manifest.integrations.length} candidates, quoted paths, and shell syntax`);
} finally {
  await vite.close();
}
