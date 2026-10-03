import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import CachePolicy from 'http-cache-semantics';

const expectedPatch = 'vendor/http-cache-semantics';
const expectedSourceHashes = {
  'index.js': 'fc7b3f0265b7a7d0fee83bafa47186a66495720d3179801c2be3083de6d0cf76',
  LICENSE: 'ab868ad5a2ef5068560d9cd3b2180ec63c140bb4c5cae1ba779d300a0ac74fa3',
};

const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const lockedDependency = packageLock.packages?.['node_modules/http-cache-semantics'];
const lockedVendor = packageLock.packages?.['vendor/http-cache-semantics'];

assert.equal(
  lockedDependency?.resolved,
  expectedPatch,
  'http-cache-semantics must resolve to the reviewed immutable security patch',
);
assert.equal(
  lockedVendor?.version,
  '4.2.1-superii.1',
  'the patched dependency must retain its explicit local security version',
);

for (const [filename, expectedHash] of Object.entries(expectedSourceHashes)) {
  const contents = fs.readFileSync(new URL(`../vendor/http-cache-semantics/${filename}`, import.meta.url));
  const actualHash = createHash('sha256').update(contents).digest('hex');
  assert.equal(
    actualHash,
    expectedHash,
    `${filename} must match the reviewed immutable security patch`,
  );
}

function assertAttackerCannotReuse(responseHeaders, label) {
  const originalRequest = {
    url: '/private-response',
    method: 'GET',
    headers: {},
  };
  const policy = new CachePolicy(
    originalRequest,
    {
      status: 200,
      headers: responseHeaders,
    },
    { shared: true },
  );
  const attackerRequest = {
    url: '/private-response',
    method: 'GET',
    headers: { 'cache-control': 'max-stale=31536000' },
  };

  assert.equal(
    policy.satisfiesWithoutRevalidation(attackerRequest),
    false,
    `${label} must not be reusable through an attacker-controlled max-stale directive`,
  );

  const evaluation = policy.evaluateRequest(attackerRequest);
  assert.equal(
    evaluation.response,
    undefined,
    `${label} must require revalidation instead of exposing a cached response`,
  );
  assert.ok(evaluation.revalidation, `${label} must produce a revalidation request`);
}

assertAttackerCannotReuse(
  {
    'cache-control': 'max-age=600',
    'set-cookie': 'session=private-user-secret',
  },
  'shared Set-Cookie response without public opt-in',
);
assertAttackerCannotReuse(
  { 'cache-control': 'public, max-age=0, proxy-revalidate' },
  'proxy-revalidate response',
);
assertAttackerCannotReuse(
  { 'cache-control': 'public, max-age=600, no-cache' },
  'no-cache response',
);

console.log(
  'HTTP cache semantics check passed: the immutable CVE-2026-93748 patch blocks max-stale reuse of protected shared responses.',
);
