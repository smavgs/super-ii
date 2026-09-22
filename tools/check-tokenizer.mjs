import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'runtime/src/superii_runtime/tokenizer_packs.py',
  'runtime/src/superii_runtime/inspectors/gguf_tokenizers.py',
  'runtime/src/superii_runtime/runtimes/llama_tokenizer.py',
  'runtime/install-llama-macos.sh',
  'runtime/tests/test_tokenizer_packs.py',
  'runtime/tests/test_gguf_tokenizers.py',
  'runtime/tests/test_llama_tokenizer.py',
  'database/migrations/0024_verified_tokenizer.sql',
  'src/components/TokenizerWorkbench.astro',
  'src/lib/browser-tokenizer.ts',
  'src/lib/tokenizers.ts',
  'src/lib/tokenizer-openapi.ts',
  'src/pages/tokenizer.astro',
  'src/pages/api/tokenizers/[owner]/[slug]/manifest.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/encode.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/decode.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/pack/[...path].ts',
  'src/pages/api/tokenizers/[owner]/[slug]/revisions/[revision]/pack/[...path].ts',
];

for (const path of requiredFiles) {
  if (!existsSync(path)) throw new Error(`Tokenizer contract is missing ${path}`);
}

const requireText = (path, values) => {
  const source = readFileSync(path, 'utf8');
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`${path} is missing ${value}`);
  }
  return source;
};

requireText('runtime/src/superii_runtime/publication_policy.py', [
  'superii-auto-publish-v2',
  'verified_tokenizer_required',
]);
requireText('runtime/src/superii_runtime/tokenizer_packs.py', [
  'superii-tokenizer-pack-v1',
  'export_portable_tokenizer',
  'write_vocab_only_gguf',
  'export_portable_gguf_tokenizer',
  'verification_vectors',
]);
requireText('runtime/install-llama-macos.sh', [
  'b10516',
  'ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30',
  'b7adecf7bd2cde577ddabee8357a72409165d8104f43b4acee9f1b98cc9c447a',
]);
requireText('runtime/run-macos-service.sh', [
  'vendor/llama.cpp/b10516',
  'SUPERII_LLAMA_SERVER_COMMAND="$llama_root/llama-server"',
  'SUPERII_LLAMA_TOKENIZE_COMMAND="$llama_root/llama-tokenize"',
]);
requireText('src/components/RepositoryPage.astro', ['TokenizerWorkbench']);
requireText('src/components/TokenizerWorkbench.astro', [
  'See exactly how this model reads your text.',
  'data-tokenizer-boundaries',
  'data-tokenizer-revision',
  'data-tokenizer-pack',
  'const renderLimit = 500',
]);
requireText('src/lib/browser-tokenizer.ts', [
  'Browser tokenizer did not match its verified reference vectors.',
  "execution: 'browser'",
  'manifest.source_revision_id',
]);
requireText('src/lib/tokenizers.ts', [
  'artifact_url_template',
  'model_commit_sha',
  'requestedRevision',
]);
requireText('src/lib/mcp-server.ts', [
  "'get_tokenizer_manifest'",
  "'tokenize_model_text'",
  "'decode_model_tokens'",
]);
for (const path of [
  'src/pages/api/tokenizers/[owner]/[slug]/encode.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/decode.ts',
  'src/pages/api/repositories/[repositoryId]/tokenize.ts',
  'src/pages/api/repositories/[repositoryId]/detokenize.ts',
]) {
  requireText(path, ['readBoundedJsonObject', 'request contains unsupported fields']);
}
requireText('src/pages/openapi.json.ts', ['tokenizerApiPaths', 'tokenizerOpenApiSchemas']);
requireText('sdk/python/src/superii/client.py', [
  'def tokenizer_manifest(',
  'def tokenize(',
  'def decode_tokens(',
]);
requireText('src/pages/docs.astro', [
  'Verified Tokenizer',
  'superii tokenize owner/model',
]);
requireText('SYSTEM-STATE.md', ['Verified model tokenizer packs']);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.scripts.validate.includes('check-tokenizer.mjs')) {
  throw new Error('Tokenizer validator is not part of npm run validate');
}

console.log('Verified tokenizer contracts are present.');
