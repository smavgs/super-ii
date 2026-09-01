#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = {
  homepage: await readFile(resolve(root, 'src/pages/index.astro'), 'utf8'),
  layout: await readFile(resolve(root, 'src/layouts/BaseLayout.astro'), 'utf8'),
  component: await readFile(resolve(root, 'src/components/SuperAssistant.astro'), 'utf8'),
  client: await readFile(resolve(root, 'src/scripts/super-assistant.ts'), 'utf8'),
  endpoint: await readFile(resolve(root, 'src/pages/api/assistant/token.ts'), 'utf8'),
  config: await readFile(resolve(root, 'src/lib/gemini-live.ts'), 'utf8'),
  privacy: await readFile(resolve(root, 'src/pages/legal/privacy.astro'), 'utf8'),
};

const errors = [];
function requireText(file, label, text) {
  if (!files[file].includes(text)) errors.push(`${label}: missing ${text}`);
}

requireText('homepage', 'homepage', '<SuperAssistant />');
if (files.layout.includes('SuperAssistant')) errors.push('assistant must not be mounted in the shared layout');
requireText('component', 'component', "import('../scripts/super-assistant')");
requireText('component', 'component', 'Hi. Ask me anything.');
requireText('client', 'client', 'BidiGenerateContentConstrained');
requireText('client', 'client', 'realtimeInput');
requireText('client', 'client', 'groundingMetadata');
requireText('endpoint', 'endpoint', 'sameOrigin(request)');
requireText('endpoint', 'endpoint', 'ensureAuthenticatedProfile');
requireText('endpoint', 'endpoint', "consumeRateLimit(locals, request, sql, 'assistant.token'");
requireText('endpoint', 'endpoint', "runtimeValue(locals, 'GEMINI_API_KEY')");
requireText('endpoint', 'endpoint', '/v1beta/auth_tokens');
requireText('config', 'config', "gemini-3.1-flash-live-preview");
requireText('config', 'config', "GEMINI_LIVE_API_VERSION = 'v1alpha'");
requireText('config', 'config', 'bidiGenerateContentSetup');
requireText('config', 'config', 'outputAudioTranscription');
requireText('config', 'config', 'googleSearch');
requireText('privacy', 'privacy', '<strong>Google</strong>');
requireText('privacy', 'privacy', 'current page session');

if (/localStorage|sessionStorage/.test(files.client)) {
  errors.push('client conversation state must not be persisted in browser storage');
}

for (const [name, source] of Object.entries(files)) {
  if (/AQ\.[A-Za-z0-9_-]{20,}/.test(source)) errors.push(`${name}: API key-shaped value found`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('OK: homepage-only lazy assistant, temporary-token boundary, session-only memory, and privacy disclosure verified');
