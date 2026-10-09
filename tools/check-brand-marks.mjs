#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const files = {
  component: read('src/components/BrandMark.astro'),
  homepage: read('src/pages/index.astro'),
  frontier: read('src/pages/frontier-ai.astro'),
  agents: read('src/pages/agents.astro'),
  useModel: read('src/components/UseModel.astro'),
  starter: read('src/components/AgentStarter.astro'),
  worker: read('src/components/AIWorkerStarter.astro'),
  bridge: read('src/pages/bring-my-work.astro'),
  transparent: read('src/components/TransparencyChecker.astro'),
  catalog: read('src/components/Catalog.astro'),
  robot: read('src/pages/robot/index.astro'),
  notebook: read('src/components/NotebookDocument.astro'),
  skills: read('src/scripts/skills-page.ts'),
  checkout: read('src/pages/checkout/[orderId].astro'),
  participationCheckout: read('src/pages/checkout/participation/[orderId].astro'),
  commerce: read('src/components/CommerceWorkspace.astro'),
  security: read('src/pages/security.astro'),
  repository: read('src/pages/repositories/[repositoryId]/edit.astro'),
  profile: read('src/pages/people/[handle].astro'),
  organization: read('src/pages/organizations/[handle].astro'),
  footer: read('src/components/Footer.astro'),
  styles: read('src/styles/global.css'),
};

const fail = (message) => { throw new Error(`Brand-mark check failed: ${message}`); };
const requireText = (file, text) => {
  if (!files[file].includes(text)) fail(`${file} is missing ${JSON.stringify(text)}`);
};

for (const name of [
  'cloudflare', 'clerk', 'ethereum', 'github', 'github-actions', 'huggingface',
  'neon', 'nvidia', 'ollama', 'raspberrypi', 'usdc', 'x', 'youtube',
]) requireText('component', name);
for (const name of ['codex', 'claude', 'comfyui', 'hermes', 'kimi', 'lmstudio', 'openclaw', 'opencode']) {
  requireText('component', `${name}:`);
}
requireText('component', "aria-hidden=\"true\"");

const surfaceRequirements = {
  homepage: ['brand="ollama"', 'brand="lmstudio"', 'brand="comfyui"'],
  frontier: ['brand="nvidia"', 'brand="opencode"', 'brand="kimi"'],
  agents: ['<BrandMark', 'connectorBrand'],
  useModel: ['integrationBrand', 'agentBrand', 'notebookBrand'],
  starter: ['brand="ollama"', 'brand="opencode"'],
  worker: ['brand="qwen"', 'brand="ollama"', 'brand="opencode"'],
  bridge: ['brand="huggingface"'],
  transparent: ['brand="huggingface"'],
  catalog: ['brand="huggingface"'],
  robot: ['brand="raspberrypi"', "'nvidia'"],
  notebook: ['brand="colab"'],
  checkout: ['brand="usdc"', 'brand="ethereum"', 'brand="nowpayments"'],
  participationCheckout: ['brand="usdc"', 'brand="ethereum"', 'brand="nowpayments"'],
  commerce: ['brand="usdc"', 'brand="ethereum"', 'brand="nowpayments"'],
  security: ['brand="cloudflare"', 'brand="clerk"', 'brand="neon"', 'brand="huggingface"', 'brand="nowpayments"'],
  repository: ['brand="github-actions"'],
  profile: ['<CardServiceIcon'],
  organization: ['<CardServiceIcon'],
  footer: ['brand="x"'],
};

for (const [file, requirements] of Object.entries(surfaceRequirements)) {
  for (const text of requirements) requireText(file, text);
}

for (const text of ['programSimpleIcons', 'siGithub', 'siHuggingface', 'siGooglegemini', 'siX', 'siYoutube']) {
  requireText('skills', text);
}
for (const selector of ['.brand-inline', '.brand-heading', '.payment-provider-row', '.security-provider-map']) {
  requireText('styles', selector);
}

console.log('OK: high-priority Super ii surfaces render compact, recognizable provider marks with responsive payment and security rows.');
