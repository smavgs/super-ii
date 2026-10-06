#!/usr/bin/env node
// Verify the transitive security override against the installer's actual API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const installerRequire = createRequire(require.resolve('onnxruntime-node'));
const { bootstrap } = installerRequire('global-agent');
const proxy = http.createServer((request, response) => {
  assert.equal(request.url, 'http://superii-installer-check.invalid/');
  response.end('local installer proxy');
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
try {
  process.env.SUPERII_INSTALLER_TEST_HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.SUPERII_INSTALLER_TEST_NO_PROXY = '';
  bootstrap({ environmentVariableNamespace: 'SUPERII_INSTALLER_TEST_' });
  const body = await new Promise((resolve, reject) => {
    const request = http.get('http://superii-installer-check.invalid/', response => {
      let value = '';
      response.on('data', chunk => { value += chunk; });
      response.on('end', () => resolve(value));
    });
    request.setTimeout(5000, () => request.destroy(new Error('Installer proxy test timed out')));
    request.on('error', reject);
  });
  assert.equal(body, 'local installer proxy');
  console.log('OK: the ONNX installer proxy dependency retains its bootstrap and HTTP proxy behavior');
} finally {
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
}
