#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [
  memberActions,
  signUp,
  signIn,
  home,
  header,
  agentBash,
  agentsPage,
  registryText,
  schema,
] = await Promise.all([
  read('src/lib/member-actions.ts'),
  read('src/pages/sign-up.astro'),
  read('src/pages/sign-in.astro'),
  read('src/pages/index.astro'),
  read('src/components/Header.astro'),
  read('src/components/AgentBash.astro'),
  read('src/pages/agents.astro'),
  read('src/content/agent-connectors.json'),
  read('public/schemas/agent-connector-registry-v1.json').then(JSON.parse),
]);

const requireText = (source, marker, surface) => assert.ok(source.includes(marker), `${surface} is missing ${marker}`);

for (const marker of ['isSignedInUser', 'memberAction', 'signedOutLabel', 'signedInLabel', 'localizedHref']) {
  requireText(memberActions, marker, 'member action helper');
}
for (const source of [signUp, signIn]) {
  requireText(source, 'safeAuthRedirect', 'auth page');
  requireText(source, "Cache-Control', 'private, no-store", 'auth page');
  requireText(source, 'isSignedInUser(Astro.locals)', 'auth page');
  requireText(source, 'Astro.redirect(', 'auth page');
}
for (const marker of [
  "destination: '/account'",
  "destination: '/account#agent-starter'",
  "destination: '/account?welcome=ai-worker#ai-worker'",
  "signedInLabel: 'Open workspace'",
  "signedInLabel: 'Open Agent Starter'",
  "signedInLabel: 'Open my AI worker'",
]) requireText(home, marker, 'homepage member actions');
assert.ok(!home.includes('href="/sign-up"'), 'homepage must not send members through a hard-coded signup page');
assert.ok(!header.includes('href="/sign-up"'), 'header signup links must preserve the workspace destination');
requireText(agentBash, "signedInLabel: 'Manage agent access'", 'agent handoff');

const bundled = await build({
  absWorkingDir: new URL('../', import.meta.url).pathname,
  entryPoints: ['src/lib/auth-redirects.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const redirects = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const safe = redirects.safeAuthRedirect;
for (const destination of [
  '/account',
  '/account#agent-starter',
  '/account?welcome=ai-worker#ai-worker',
  '/account#agents',
  '/account#profile',
  '/account#repositories',
  '/new',
  '/new?kind=model',
  '/new?kind=dataset',
  '/new?kind=space',
  '/skills',
  '/frontier-ai#setup',
  '/pricing',
  '/transparent/hf-model-report',
  '/account/connect?request=018f0000-0000-7000-8000-00000000c350',
]) assert.equal(safe(destination, '/account'), destination, `expected safe destination: ${destination}`);
assert.equal(safe('/ru/account#agent-starter', '/account'), '/account#agent-starter');
assert.equal(safe('/zh-cn/new?kind=model', '/account'), '/new?kind=model');
for (const unsafe of [
  'https://evil.example/account',
  '//evil.example/account',
  '/account?next=https://evil.example',
  '/new?kind=anything',
  '/transparent/report?next=evil',
  '/account/connect?request=not-a-uuid',
  'javascript:alert(1)',
]) assert.equal(safe(unsafe, '/account'), '/account', `unsafe redirect escaped: ${unsafe}`);

const registry = JSON.parse(registryText);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRegistry = ajv.compile(schema);
const validRegistry = validateRegistry(registry);
assert.equal(validRegistry, true, `connector registry schema errors: ${JSON.stringify(validateRegistry.errors)}`);
const connectorIds = registry.connectors.map((connector) => connector.id);
assert.equal(connectorIds.filter((id) => id.startsWith('opencode')).length, 1, 'OpenCode must render as one client');
assert.ok(connectorIds.includes('opencode'));
assert.ok(!connectorIds.includes('opencode-v1'));
assert.ok(!connectorIds.includes('opencode-v2'));
const openCode = registry.connectors.find((connector) => connector.id === 'opencode');
assert.deepEqual(openCode.configuration_variants.map((variant) => variant.configuration_version), ['current', 'v2']);
const muse = registry.connectors.find((connector) => connector.id === 'muse-code');
assert.equal(muse.status_label, 'Verified setup');
assert.equal(muse.configuration_version, '1.4.4');
assert.equal(muse.config_path, '~/.config/muse/settings.json');
const museConfig = JSON.parse(muse.config_example);
assert.deepEqual(museConfig, {
  schema_version: 1,
  mcpServers: {
    superii: {
      type: 'streamable-http',
      url: 'https://superii.site/mcp',
      enabled: true,
      required: false,
    },
  },
});
for (const marker of ['configuration_variants', 'muse-code', 'Choose your installed configuration']) {
  requireText(agentsPage, marker, 'agents connector UI');
}

console.log('Member navigation and agent connector check passed: signed-in CTAs bypass auth, redirects stay local, OpenCode is one card, and Muse Code exposes the verified 1.4.4 MCP setup.');
