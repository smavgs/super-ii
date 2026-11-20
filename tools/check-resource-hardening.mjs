import assert from 'node:assert/strict';
import { prepareEarlyRequest, protocolBodyLimit } from '../src/lib/early-request-guard.ts';
import { validRedirectUri } from '../src/lib/connection-policy.ts';
import { requireRecentVerification } from '../src/lib/sensitive-action.ts';

const accepted = { limit: async () => ({ success: true }) };
const denied = { limit: async () => ({ success: false }) };
const env = { CONTACT_HASH_SALT: 'local-test-salt', REQUEST_RATE_LIMITER: accepted, WRITE_RATE_LIMITER: accepted };
const req = (path, init = {}) => new Request(`https://superii.site${path}`, {
  ...init, headers: { 'cf-connecting-ip': '192.0.2.1', ...init.headers },
});
for (const path of ['/mcp', '/mcp/work', '/mcp/social', '/mcp/robot', '/mcp/commerce']) {
  const acceptedRequest = await prepareEarlyRequest(req(path, { method: 'POST', body: '{"method":"initialize"}' }), env);
  assert.ok(acceptedRequest instanceof Request);
  assert.equal(await acceptedRequest.text(), '{"method":"initialize"}');
  const tooLarge = await prepareEarlyRequest(req(path, { method: 'POST', body: 'x'.repeat(1_048_577) }), env);
  assert.equal(tooLarge.status, 413, `${path} counts actual bytes without Content-Length`);
}
let cancelled = false;
const oversizedStream = new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(20_000)); },
  cancel() { cancelled = true; },
});
assert.equal((await prepareEarlyRequest(req('/api/oauth/register', {
  method: 'POST', body: oversizedStream, duplex: 'half',
}), env)).status, 413);
assert.ok(cancelled, 'stop reading an excessive body');
assert.equal((await prepareEarlyRequest(req('/api/oauth/register', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } }), env)).status, 413);
assert.equal((await prepareEarlyRequest(req('/mcp'), {})).status, 503, 'missing production protection fails closed');
assert.equal((await prepareEarlyRequest(req('/mcp'), { ...env, REQUEST_RATE_LIMITER: denied })).status, 429);
assert.equal((await prepareEarlyRequest(req('/api/assistant/chat', { method: 'POST', body: '{}' }), { ...env, WRITE_RATE_LIMITER: denied })).headers.get('retry-after'), '60');
assert.equal((await prepareEarlyRequest(req('/mcp'), { ...env, REQUEST_RATE_LIMITER: { limit: async () => { throw Error('unavailable'); } } })).status, 503);
assert.equal((await prepareEarlyRequest(new Request('https://preview.workers.dev/mcp'), env)).status, 421);
assert.ok(await prepareEarlyRequest(new Request('http://127.0.0.1:4321/mcp'), {}) instanceof Request);
const keys = [];
const capture = { limit: async ({ key }) => { keys.push(key); return { success: true }; } };
for (const path of ['/mcp', '/a2a/v1/message:send', '/api/search']) {
  await prepareEarlyRequest(req(path, { headers: { 'user-agent': path } }), { ...env, REQUEST_RATE_LIMITER: capture });
}
assert.equal(new Set(keys).size, 1, 'switching protocol or user agent does not reset network admission');
assert.match(keys[0], /^[a-f0-9]{64}$/);
assert.equal(protocolBodyLimit('/api/transfers/123'), null);
const upload = req('/api/transfers/123', { method: 'PATCH', body: 'binary' });
assert.equal(await prepareEarlyRequest(upload, env), upload, 'binary transfer stays streaming');
assert.equal(protocolBodyLimit('/api/tokenizers/owner/model/decode'), null, 'preserve larger validated tokenizer payloads');
for (const uri of ['https://example.com/callback', 'http://127.0.0.1:9876/callback', 'http://localhost:9876/callback', 'http://[::1]:9876/callback']) assert.ok(validRedirectUri(uri), uri);
for (const uri of ['https://*.any/cb', 'https://%2a.example/cb', 'https://user:pass@example.com/cb', 'https://example.com/cb#token', 'http://example.com/callback', 'javascript:alert(1)']) assert.equal(validRedirectUri(uri), false, uri);
console.log('Resource hardening: protocol bounds, stream cancellation, pre-database admission, fail-closed behavior, and redirect validation passed');

assert.equal(requireRecentVerification({}).status, 503);
assert.equal(requireRecentVerification({ auth: () => ({ userId: null }) }).status, 401);
assert.equal(requireRecentVerification({ auth: () => ({ userId: 'test', has: () => false }) }).status, 403);
let checked;
assert.equal(requireRecentVerification({ auth: () => ({ userId: 'test', has: input => { checked = input; return true; } }) }), null);
assert.deepEqual(checked, { reverification: { level: 'first_factor', afterMinutes: 10 } });
