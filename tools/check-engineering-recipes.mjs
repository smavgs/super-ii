import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { spawnSync } from 'node:child_process';
const temporary = await mkdtemp(path.join(tmpdir(), 'superii-recipes-'));
const bundle = path.join(temporary, 'recipes.mjs');
await build({ entryPoints: ['src/lib/engineering-recipes.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', loader: { '.toml': 'text', '.lock': 'text', '.py': 'text', '.yml': 'text' }, logLevel: 'silent' });
const { generateProject, recipeRequest } = await import(pathToFileURL(bundle));
await build({ entryPoints: ['src/lib/recipe-openapi.ts'], outfile: path.join(temporary, 'openapi.mjs'), bundle: true, platform: 'node', format: 'esm', loader: { '.toml': 'text', '.lock': 'text', '.py': 'text', '.yml': 'text' }, logLevel: 'silent' });
const { recipeApiPaths } = await import(pathToFileURL(path.join(temporary, 'openapi.mjs')));
await build({ entryPoints: ['src/lib/recipe-zip.ts'], outfile: path.join(temporary, 'zip.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { projectZip } = await import(pathToFileURL(path.join(temporary, 'zip.mjs')));
const { githubWorkflowRef, githubRepositoryMatchesSubject, validGithubSubject } = await import('../src/lib/github-oidc.ts');
const { recipeInputRequest } = await import('../src/lib/recipe-access.ts');
const credentials = new Request('https://superii.site/api/recipes/generate', { headers: { authorization: 'Bearer destination', cookie: 'session=fixture', 'x-superii-generator-token': 'sii_' + 'a'.repeat(64), 'x-superii-dataset-token': 'sii_' + 'b'.repeat(64) } });
const isolated = recipeInputRequest(credentials, 'generator');
assert.equal(isolated.headers.get('authorization'), 'Bearer sii_' + 'a'.repeat(64));
assert.equal(isolated.headers.get('cookie'), null);
assert.equal(isolated.headers.get('x-superii-dataset-token'), null);
assert.equal(recipeInputRequest(credentials, 'embedding').headers.get('authorization'), 'Bearer destination');
assert.throws(() => recipeInputRequest(credentials, 'generator', 'https://example.invalid/'));
assert.throws(() => recipeInputRequest(new Request(credentials.url, { headers: { 'x-superii-generator-token': 'invalid' } }), 'generator'));
const regular = 'smavgs/super-ii/.github/workflows/publish-project.yml@refs/heads/main';
assert.equal(githubWorkflowRef({ workflow_ref: regular }), regular);
assert.equal(githubWorkflowRef({ workflow_ref: regular, job_workflow_ref: 'invalid' }), null);
assert.equal(githubWorkflowRef({ workflow_ref: regular, job_workflow_ref: null }), null);
assert.equal(githubWorkflowRef({ workflow_ref: regular, job_workflow_ref: regular.replace('publish-project', 'reusable') }), regular.replace('publish-project', 'reusable'));
const immutableIdentity = { sub: 'repo:fixture@123/project@456:ref:refs/heads/main', repository: 'fixture/project', repository_owner_id: '123', repository_id: '456' };
assert.ok(validGithubSubject(immutableIdentity.sub));
assert.ok(githubRepositoryMatchesSubject(immutableIdentity));
assert.ok(githubRepositoryMatchesSubject({ sub: 'repo:fixture/project:ref:refs/heads/main', repository: 'fixture/project' }));
for (const changed of [
 { repository: 'other/project' }, { repository_owner_id: '124' }, { repository_id: '457' },
 { repository_id: undefined }, { repository_owner_id: 123 },
 { sub: 'repo:fixture@123/project:ref:refs/heads/main' },
 { sub: 'repo:fixture/project@456:ref:refs/heads/main' },
 { sub: 'repo:fixture@123/project@456:ref:refs/heads/main\n' },
]) assert.equal(githubRepositoryMatchesSubject({ ...immutableIdentity, ...changed }), false);
const schema = JSON.parse(await readFile('public/schemas/superii-recipe-v1.json', 'utf8'));
const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema);
const validateRequest = ajv.compile(recipeApiPaths['/api/recipes/generate'].post.requestBody.content['application/json'].schema);
function source(role) {
 const kind = role === 'dataset' ? 'dataset' : 'model';
 return { repository: { kind, owner: 'fixture', slug: role }, revision: { commit_sha: 'c'.repeat(64), manifest_sha256: 'a'.repeat(64) }, compatibility: { architecture: role === 'embedding' ? 'BertModel' : 'GPT2LMHeadModel' }, files: (kind === 'dataset' ? ['data.jsonl'] : ['config.json', 'tokenizer.json', 'model.safetensors']).map(name => ({ path: name, size_bytes: 100, sha256: 'b'.repeat(64) })) };
}
const resolved = { generator: source('generator'), embedding: source('embedding'), dataset: source('dataset') };
const ref = role => ({ repository: `fixture/${role}`, revision: 'c'.repeat(64) });
const projects = [];
for (const outcome of ['rag', 'api', 'sft']) {
 const request = { outcome, generator: ref('generator'), embedding: outcome === 'rag' ? ref('embedding') : null, dataset: outcome === 'sft' ? ref('dataset') : null, configuration: { learning_rate: 0.000001, observability: true, ...(outcome === 'rag' ? { framework: 'langchain', ui: 'gradio' } : {}) } };
 assert.ok(validateRequest(request), JSON.stringify(validateRequest.errors));
 const project = generateProject(request, resolved);
 assert.ok(validate(project.recipe), JSON.stringify(validate.errors));
 assert.equal(project.recipe.configuration.seed, 42);
 assert.deepEqual(generateProject(request, resolved), project);
 const directory = path.join(temporary, outcome);
 await mkdir(directory);
 for (const [name, text] of Object.entries(project.files)) { const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); }
 await writeFile(path.join(temporary, outcome + '.zip'), projectZip(project.files));
 assert.throws(() => generateProject({ ...request, generator: { ...ref('generator'), revision: 'd'.repeat(64) } }, resolved));
 assert.throws(() => generateProject({ ...request, generator: { ...ref('generator'), files: ['../escape'] } }, resolved));
 projects.push(directory);
}
const ragRequest = { outcome: 'rag', generator: ref('generator'), embedding: ref('embedding') };
for (const [generator, embedding] of [['gpt2', 'bert'], ['GPTNeoXForCausalLM', 'XLMRobertaModel']]) {
 assert.ok(generateProject(ragRequest, {
  ...resolved,
  generator: { ...resolved.generator, compatibility: { architecture: generator } },
  embedding: { ...resolved.embedding, compatibility: { architecture: embedding } },
 }).recipe.inputs.embedding);
}
for (const role of ['generator', 'embedding']) {
 for (const architecture of ['UntrustedCustomModel', 'BertForSequenceClassification', 'GPT2LMHeadModelCustom']) {
  assert.throws(() => generateProject(ragRequest, { ...resolved, [role]: { ...resolved[role], compatibility: { architecture } } }));
 }
}
assert.equal(recipeRequest.safeParse({ outcome: 'sft', generator: ref('generator'), dataset: ref('dataset'), accelerator: 'metal' }).success, false);
assert.equal(recipeRequest.safeParse({ outcome: 'rag', generator: ref('generator') }).success, false);
for (const invalid of [
 { outcome: 'api', generator: { ...ref('generator'), revision: 'main' } },
 { outcome: 'api', generator: ref('generator'), command: 'arbitrary-code' },
 { outcome: 'rag', generator: ref('generator') },
 { outcome: 'rag', generator: ref('generator'), embedding: null },
 { outcome: 'sft', generator: ref('generator'), dataset: null },
 { outcome: 'sft', generator: ref('generator'), dataset: ref('dataset'), accelerator: 'metal' },
 { outcome: 'sft', generator: ref('generator'), dataset: ref('dataset'), configuration: { ui: 'gradio' } },
 { outcome: 'api', generator: ref('generator'), runtime: 'mlx' },
]) assert.equal(validateRequest(invalid), false, JSON.stringify(invalid));
assert.ok(validateRequest({ outcome: 'api', generator: ref('generator'), runtime: 'mlx', accelerator: 'metal' }));
assert.throws(() => projectZip({ '../unsafe': 'bad' }));
for (const name of ['superii-recipe-v1.json', 'superii-run-v1.json']) assert.equal(await readFile('public/schemas/' + name, 'utf8'), await readFile('sdk/python/src/superii/recipes/schemas/' + name, 'utf8'));
// Cross-language checksum, archive CRC/path safety and Python syntax validation.
const python = process.env.SUPERII_TEST_PYTHON || 'sdk/python/.venv/bin/python';
const checked = spawnSync(python, ['-c', `import json, sys, zipfile, ast\nfrom pathlib import Path\nfrom superii.recipes import Recipe\nfor directory in map(Path,sys.argv[1:]):\n Recipe.read(directory/'superii-recipe.json')\n for item in directory.rglob('*.py'): ast.parse(item.read_text())\n with zipfile.ZipFile(directory.with_suffix('.zip')) as archive:\n  assert archive.testzip() is None\n  assert set(archive.namelist()) == {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}\nprint('Recipe contracts, archives and generated Python verified')`, ...projects], { encoding: 'utf8' });
assert.equal(checked.status, 0, checked.stderr);
console.log(checked.stdout.trim());
console.log('Generated projects:', temporary);
if (process.env.SUPERII_RECIPE_PREVIEW === '1') {
  const { createServer, request: proxyRequest } = await import('node:http');
  createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/recipes/generate') {
      let text = '';
      for await (const chunk of request) { text += chunk; if (text.length > 16384) { response.writeHead(413).end(); return; } }
      try { const project = generateProject(JSON.parse(text), resolved); response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(project)); }
      catch (error) { response.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
      return;
    }
    const upstream = proxyRequest({ hostname: '127.0.0.1', port: 4326, path: request.url, method: request.method, headers: { ...request.headers, host: '127.0.0.1:4326' } }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
    upstream.on('error', () => response.writeHead(502).end('Start the local Astro preview on 4326'));
    request.pipe(upstream);
  }).listen(4327, '127.0.0.1', () => console.log('Local-only fixture preview: http://127.0.0.1:4327/build'));
}
