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
  'src/lib/tokenizer-models.ts',
  'src/lib/tokenizer-openapi.ts',
  'src/pages/tokenizer.astro',
  'src/pages/api/tokenizers/[owner]/[slug]/manifest.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/encode.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/decode.ts',
  'src/pages/api/tokenizers/[owner]/[slug]/pack/[...path].ts',
  'src/pages/api/tokenizers/[owner]/[slug]/revisions/[revision]/pack/[...path].ts',
  'src/pages/api/tokenizers/models.ts',
  'docs/verification/sdk-0.3.0-release.json',
  'docs/verification/tokenizer-production.json',
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
  'converter_variant',
]);
requireText('runtime/src/superii_runtime/inspectors/tokenizers.py', [
  'unicode-nfd',
  'multiscript-extra',
  'emoji-family',
  'backend.id_to_token',
]);
requireText('runtime/src/superii_runtime/inspectors/gguf_tokenizers.py', [
  'normalizer-disabled',
  '_conversion_variants',
  '_matches_reference',
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
requireText('src/styles/global.css', [
  'grid-template-columns: minmax(0, 1fr);',
  '.tokenizer-workbench > *',
  '.tokenizer-table-wrap',
  'max-width: 100%;',
  '.tokenizer-form[hidden]',
  '.tokenizer-model-search',
]);
requireText('src/lib/browser-tokenizer.ts', [
  'Browser tokenizer did not match its verified reference vectors.',
  "execution: 'browser'",
  'manifest.source_revision_id',
  'id_to_token',
  'canUseBrowserFallback',
  'revisionQuery',
]);
requireText('src/lib/tokenizers.ts', [
  'artifact_url_template',
  'model_commit_sha',
  'requestedRevision',
  'recordedTokenizerManifest',
  'cache.put',
]);
const tokenizerPage = requireText('src/pages/tokenizer.astro', [
  'data-tokenizer-search-input',
  'data-tokenizer-search-results',
  'superii-tokenizer-recent-v1',
  'history.replaceState',
  'revision_id',
]);
if (tokenizerPage.includes('data-tokenizer-model-picker') || tokenizerPage.includes('<select')) {
  throw new Error('The standalone tokenizer must use bounded search instead of a growing model select.');
}
requireText('src/pages/api/tokenizers/models.ts', [
  'searchTokenizerModels',
  'tokenizer-model-search',
  '.max(10)',
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
requireText('SYSTEM-STATE.md', [
  '| Verified model tokenizer packs | production | live on both public text models |',
  '| Public read-only Super ii MCP | production | live with 19 read-only tools |',
  'superii-sdk 0.3.0 on PyPI',
]);
requireText('src/lib/system-state-localization.ts', [
  "availability: 'работают для обеих публичных текстовых моделей'",
  "availability: 'работают 19 инструментов только для чтения'",
  'superii-sdk 0.3.0 доступен в PyPI',
]);
requireText('docs/verification/tokenizer-production.json', [
  '"status": "production"',
  '7611a6ab046d0aff1b2630e751dfc05162e8a8d982be314603cac84409308a16',
  '4045187f20be606fa8ee49660625f72dc54f32adf5a605104ff6498bf8590a40',
  '"tool_count": 19',
]);
requireText('docs/verification/sdk-0.3.0-release.json', [
  '"version": "0.3.0"',
  '01ac177a9991b8b8df81ff2815423593a217aa8ea1d89c2a1f1ca1fcc3a2f007',
  'a166aafc1d52a4cd999b2959115aabe85eea8e17b9b3176bb14a224c1a3a337e',
]);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.scripts.validate.includes('check-tokenizer.mjs')) {
  throw new Error('Tokenizer validator is not part of npm run validate');
}

console.log('Verified tokenizer contracts are present.');
