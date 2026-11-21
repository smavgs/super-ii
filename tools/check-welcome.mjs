import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function bundle(entry, mocks = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{ name: 'test-boundaries', setup(b) {
      b.onResolve({ filter: /^(?:@\/lib\/|\.\/db$)/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'test' } : null);
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: mocks[args.path], loader: 'ts' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { requestedHandle } = await bundle('src/lib/welcome.ts');
const { analyticsChoice, parseExperience, experienceSurface } = await bundle('src/lib/experience.ts');
for (const value of ['a', 'my-lab', '7bots', 'a'.repeat(30)]) assert.equal(requestedHandle(value), value);
assert.equal(requestedHandle(' @My-Lab '), 'my-lab');
for (const value of ['', '-', 'lab-', '-lab', 'a'.repeat(31), 'a_b', '用户', 'admin', '@support', {}, null, '<script>']) assert.equal(requestedHandle(value), null);
assert.equal(analyticsChoice('x=a; superii-analytics=allow-v1; y=b'), 'allow');
assert.equal(analyticsChoice('superii-analytics=deny-v1'), 'deny');
for (const value of ['', 'superii-analytics=true', 'superii-analytics=allow-v0', 'fake-superii-analytics=allow-v1']) assert.equal(analyticsChoice(value), null);
assert.equal(experienceSurface('/ru/models/example/model'), 'models');
assert.equal(experienceSurface('/zh-cn'), 'home');
for (const path of ['/chats', '/account/cards', '/api/profile', '/aliens-list/messages']) assert.equal(experienceSurface(path), null);
const event = { event: 'handle_check', surface: 'home', locale: 'en' };
assert.deepEqual(parseExperience(event), event);
for (const invalid of [{ ...event, handle: 'private' }, { ...event, url: '/chats/private' }, { ...event, locale: ['en'] }, { ...event, event: 'typed_private_message' }, { ...event, surface: 'workspace' }]) assert.equal(parseExperience(invalid), null);

const state = globalThis.__welcomeTest = { sqlCalls: [], rate: 'allowed', available: true, database: true };
const mocks = {
  '@/lib/auth': `export const sameOrigin = r => r.headers.get('origin') === new URL(r.url).origin;`,
  '@/lib/db': `export const sqlClient = () => globalThis.__welcomeTest.database ? async (strings,...values) => { globalThis.__welcomeTest.sqlCalls.push({query:strings.join('?'),values}); return [{available:globalThis.__welcomeTest.available}]; } : null;`,
  '@/lib/rate-limit': `export const consumeRateLimit = async () => globalThis.__welcomeTest.rate;`,
};
const { POST: collect } = await bundle('src/pages/api/experience/events.ts', mocks);
const { POST: check } = await bundle('src/pages/api/handles/check.ts', mocks);
function request(path, body, cookie = '', origin = 'https://superii.site') {
  return { locals: {}, request: new Request(`https://superii.site${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
}
for (const cookie of ['', 'superii-analytics=deny-v1', 'superii-analytics=allow-v0']) assert.equal((await collect(request('/api/experience/events', event, cookie))).status, 204);
assert.equal(state.sqlCalls.length, 0, 'no database call is permitted without current consent');
assert.equal((await collect(request('/api/experience/events', event, 'superii-analytics=allow-v1', 'https://other.example'))).status, 403);
assert.equal((await collect(request('/api/experience/events', { ...event, message: 'private' }, 'superii-analytics=allow-v1'))).status, 422);
assert.equal(state.sqlCalls.length, 0);
assert.equal((await collect(request('/api/experience/events', event, 'superii-analytics=allow-v1'))).status, 204);
assert.deepEqual(state.sqlCalls.at(-1).values, ['handle_check','home','en']);
const count = state.sqlCalls.length;
assert.equal((await collect(request('/api/experience/events', event, 'superii-analytics=deny-v1'))).status, 204);
assert.equal(state.sqlCalls.length, count, 'withdrawal must stop subsequent writes');
state.rate = 'limited';
assert.equal((await collect(request('/api/experience/events', event, 'superii-analytics=allow-v1'))).status, 429);
assert.equal((await check(request('/api/handles/check', { handle: 'valid-name' }))).status, 429);
state.rate = 'allowed';
assert.equal((await check(request('/api/handles/check', { handle: 'valid-name' }, '', 'https://other.example'))).status, 403);
assert.deepEqual(await (await check(request('/api/handles/check', { handle: 'valid-name' }))).json(), { available: true });
state.available = false;
assert.deepEqual(await (await check(request('/api/handles/check', { handle: 'valid-name' }))).json(), { available: false });
assert.deepEqual(await (await check(request('/api/handles/check', { handle: 'admin' }))).json(), { available: false });
assert.equal((await check(request('/api/handles/check', { handle: 'a'.repeat(500) }))).status, 413);
state.database = false;
assert.equal((await check(request('/api/handles/check', { handle: 'valid-name' }))).status, 503);
delete globalThis.__welcomeTest;
const { ensureAuthenticatedProfile } = await bundle('src/lib/auth.ts', { './db': 'export const setSqlActorContext = () => {};' });
const user = { username: 'provider-name', firstName: '', lastName: '', imageUrl: null, emailAddresses: [], unsafeMetadata: { superiiRequestedHandle: 'my-chosen-name', isAdmin: true } };
const values = [];
const sql = async (_strings, ...params) => { values.push(params); return [{ profile_id: '00000000-0000-4000-8000-000000000001' }]; };
const locals = { auth: () => ({ userId: 'authenticated-user' }), currentUser: async () => user };
await ensureAuthenticatedProfile(locals, sql);
assert.equal(values.at(-1)[1], 'my-chosen-name', 'signup preference must reach allocation');
assert.equal(values.at(-1)[0], 'authenticated-user', 'metadata must not choose the authenticated identity');
user.unsafeMetadata.superiiRequestedHandle = 'admin';
await ensureAuthenticatedProfile(locals, sql);
assert.equal(values.at(-1)[1], 'provider-name', 'invalid metadata must not be allocated');
assert.equal(await ensureAuthenticatedProfile({}, sql), null);
console.log('Welcome checks passed: handle validation, consent defaults/withdrawal, strict event fields, private-route exclusion, request limits and origin checks.');
