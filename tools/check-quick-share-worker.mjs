import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
 import {GET,HEAD} from './src/pages/api/repositories/[repositoryId]/download.ts';
 import {count} from '@/lib/runtime';
 export default {fetch(request){if(new URL(request.url).pathname==='/fixture-count')return Response.json(count);return (request.method==='HEAD'?HEAD:GET)({locals:{},params:{repositoryId:'00000000-0000-4000-8000-000000000001'},request});}};
`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "worker-fixtures",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: "fixture-db",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^(?:@\/lib\/runtime|\.\/runtime)$/ }, () => ({
          path: "fixture-runtime",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /fixture-db/, namespace: "fixture" }, () => ({
          contents: `
    export function setSqlActorContext(){} export function runtimeValue(){}
    export function sqlClient(){return async(strings)=>{
      const query=strings.join('');
      if(query.includes('from app.repositories'))return [{id:'00000000-0000-4000-8000-000000000001',kind:'dataset',owner_handle:'fixture',slug:'dataset',visibility:'public',status:'published'}];
      if(query.includes('from app.repository_revisions'))return [{id:'00000000-0000-4000-8000-000000000002',commit_sha:'a'.repeat(64),manifest_sha256:'b'.repeat(64),file_count:1,total_size_bytes:'5'}];
      if(query.includes('from app.repository_files'))return [{id:'00000000-0000-4000-8000-000000000003',path:'data/hello.txt',size_bytes:'5',sha256:'c'.repeat(64)}];
      throw new Error('unexpected query');
    };}
  `,
        }));
        b.onLoad({ filter: /fixture-runtime/, namespace: "fixture" }, () => ({
          resolveDir: root,
          contents: `
    import {packageFixture} from './tools/lib/quick-package-fixture.mjs';
    export let count=0;
    export async function runtimeFetch(_locals,path,options){
      count++;
      if(!path.includes('/revisions/') || !path.endsWith('/download?commit='+'a'.repeat(64)))throw new Error('unexpected runtime path');
      return packageFixture(options);
    }
  `,
        }));
      },
    },
  ],
});
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: outputFiles[0].text,
    compatibilityDate: "2026-08-27",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  }),
);
try {
  const url = "http://localhost/download?revision=" + "a".repeat(64);
  const response = await runtime.dispatchFetch(url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.ok(bytes.includes(Buffer.from("hello")));
  assert.equal(
    await (
      await runtime.dispatchFetch("http://localhost/fixture-count")
    ).json(),
    1,
  );
  const head = await runtime.dispatchFetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const partial = await runtime.dispatchFetch(url, {
    headers: { range: "bytes=510-520", "if-range": head.headers.get("etag") },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-length"), "11");
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    bytes.subarray(510, 521),
  );
  const resumed = await runtime.dispatchFetch(url, {
    headers: { range: "bytes=521-" },
  });
  assert.deepEqual(
    Buffer.from(await resumed.arrayBuffer()),
    bytes.subarray(521),
  );
  console.log(
    "OK: actual Cloudflare Worker proxies one runtime request per package, Content-Length, body-free HEAD, exact partial ranges and resume",
  );
} finally {
  await runtime.dispose();
}
