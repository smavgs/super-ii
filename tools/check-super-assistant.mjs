#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = {
  homepage: await readFile(resolve(root, 'src/pages/index.astro'), 'utf8'),
  layout: await readFile(resolve(root, 'src/layouts/BaseLayout.astro'), 'utf8'),
  component: await readFile(resolve(root, 'src/components/SuperAssistant.astro'), 'utf8'),
  client: await readFile(resolve(root, 'src/scripts/super-assistant.ts'), 'utf8'),
  endpoint: await readFile(resolve(root, 'src/pages/api/assistant/chat.ts'), 'utf8'),
  config: await readFile(resolve(root, 'src/lib/openrouter.ts'), 'utf8'),
  rateLimit: await readFile(resolve(root, 'src/lib/rate-limit.ts'), 'utf8'),
  runtimeApi: await readFile(resolve(root, 'runtime/src/superii_runtime/api.py'), 'utf8'),
  runtimeSearch: await readFile(resolve(root, 'runtime/src/superii_runtime/web_search.py'), 'utf8'),
  pricing: await readFile(resolve(root, 'src/content/site.json'), 'utf8'),
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
requireText('component', 'component', 'data-super-assistant-web-search');
requireText('component', 'component', 'aria-pressed="false"');
requireText('component', 'component', 'Search web');
requireText('client', 'client', "fetch('/api/assistant/chat'");
requireText('client', 'client', "credentials: 'same-origin'");
requireText('client', 'client', 'web_search: webSearch');
requireText('client', 'client', "payload.code === 'search_limit_reached'");
requireText('client', 'client', 'boundedHistory');
requireText('endpoint', 'endpoint', 'sameOrigin(request)');
requireText('endpoint', 'endpoint', 'ensureAuthenticatedProfile');
requireText('endpoint', 'endpoint', "consumeRateLimit(locals, request, sql, 'assistant.chat'");
requireText('endpoint', 'endpoint', 'consumeIdentityRateLimit');
requireText('endpoint', 'endpoint', "'assistant.web_search'");
requireText('endpoint', 'endpoint', "runtimeFetch(locals, '/v1/search'");
requireText('endpoint', 'endpoint', "safe_search: 'moderate'");
requireText('endpoint', 'endpoint', "runtimeValue(locals, 'OPENROUTER_API_KEY')");
requireText('endpoint', 'endpoint', "'HTTP-Referer': 'https://www.superii.site'");
requireText('endpoint', 'endpoint', "'X-OpenRouter-Title': 'Super ii'");
requireText('config', 'config', "OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'");
requireText('config', 'config', "OPENROUTER_MODEL = 'minimax/minimax-m3:free'");
requireText('config', 'config', 'OPENROUTER_MAX_CONVERSATION_CHARS');
requireText('config', 'config', "name: 'search_web'");
requireText('config', 'config', 'openRouterToolFollowupRequest');
requireText('rateLimit', 'rate limit', 'consumeIdentityRateLimit');
requireText('runtimeApi', 'runtime API', '@app.post("/v1/search")');
requireText('runtimeApi', 'runtime API', '_auth: RuntimeAuth');
requireText('runtimeSearch', 'runtime search', 'DDGS(timeout=8)');
requireText('runtimeSearch', 'runtime search', 'normalize_results');
requireText('pricing', 'pricing', '3 web searches per day');
requireText('pricing', 'pricing', '30 web searches per day');
requireText('pricing', 'pricing', '60 web searches per member per day');
requireText('privacy', 'privacy', '<strong>OpenRouter and its routed model provider</strong>');
requireText('privacy', 'privacy', '<strong>Public web-search providers</strong>');
requireText('privacy', 'privacy', 'current page session');

if (/localStorage|sessionStorage/.test(files.client)) {
  errors.push('client conversation state must not be persisted in browser storage');
}
if (/WebSocket|access_token|GEMINI|generativelanguage\.googleapis\.com/.test(`${files.client}\n${files.endpoint}\n${files.config}`)) {
  errors.push('retired direct-browser Gemini transport remains in the assistant');
}
if (/scrapling|BeautifulSoup|playwright/i.test(files.runtimeSearch)) {
  errors.push('lightweight web search must not add crawling or page scraping');
}

for (const [name, source] of Object.entries(files)) {
  if (/sk-or-v1-[A-Za-z0-9]{20,}/.test(source)) errors.push(`${name}: OpenRouter API key-shaped value found`);
  if (/AQ\.[A-Za-z0-9_-]{20,}/.test(source)) errors.push(`${name}: Google API key-shaped value found`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('OK: opt-in web search, account allowances, authenticated DDGS runtime boundary, linked sources, bounded session memory, pricing, and privacy disclosure verified');
