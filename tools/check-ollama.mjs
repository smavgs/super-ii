import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './src/lib/ollama';export * from './src/lib/ollama-download';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  parseOllamaManifest,
  ollamaFiles,
  resolveOllamaVersion,
  boundedRemoteJson,
  streamOllamaFile,
  validOllamaSlug,
  validOllamaTag,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const catalogue = JSON.parse(
  await readFile(
    new URL("../src/data/ollama-catalog.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(
  new Set(catalogue.models.map((m) => m.slug)).size,
  catalogue.models.length,
);
for (const model of catalogue.models) {
  assert.ok(validOllamaSlug(model.slug));
  if (model.manifest) parseOllamaManifest(model.manifest);
}
for (const bad of [
  "../x",
  "x/y",
  "x?url=http://localhost",
  "https://example.com",
  "x\r\nheader",
]) {
  assert.equal(validOllamaSlug(bad), false);
  assert.equal(validOllamaTag(bad), false);
}
const digest = "sha256:" + "a".repeat(64),
  configDigest = "sha256:" + "b".repeat(64);
const manifest = {
  schemaVersion: 2,
  config: {
    mediaType: "application/vnd.docker.container.image.v1+json",
    digest: configDigest,
    size: 40,
  },
  layers: [
    { mediaType: "application/vnd.ollama.image.model", digest, size: 16 },
  ],
};
for (const change of [
  { schemaVersion: 1 },
  { layers: [{ ...manifest.layers[0], digest: "evil" }] },
  { layers: [{ ...manifest.layers[0], size: Infinity }] },
  { layers: Array(257).fill(manifest.layers[0]) },
])
  assert.throws(() => parseOllamaManifest({ ...manifest, ...change }));
await assert.rejects(
  boundedRemoteJson(new Response("x".repeat(129000))),
  /too large/,
);
let calls = [];
const resolved = await resolveOllamaVersion("qwen3", "8b", async (url) => {
  calls.push(url);
  if (url.includes("/manifests/")) return Response.json(manifest);
  if (url.includes("/blobs/"))
    return new Response(null, {
      status: 302,
      headers: {
        location:
          "https://" + "c".repeat(32) + ".r2.cloudflarestorage.com/config",
      },
    });
  return Response.json({ model_format: "gguf" });
});
assert.equal(resolved.files[0].filename, "qwen3-8b-model.gguf");
assert.equal(calls.length, 3);
const file = ollamaFiles("qwen3", "8b", manifest, "gguf")[0];
const payload = new TextEncoder().encode("GGUFabcdefghijkl");
let receivedRange,
  fetchCount = 0;
const upstream = async (url, init) => {
  fetchCount++;
  receivedRange = init.headers.get("range");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers.get("authorization"), null);
  if (receivedRange) {
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(receivedRange);
    return new Response(payload.slice(+start, +end + 1), {
      status: 206,
      headers: {
        "content-length": String(+end - +start + 1),
        "content-range": `bytes ${start}-${end}/16`,
      },
    });
  }
  return new Response(payload, { headers: { "content-length": "16" } });
};
const head = await streamOllamaFile(
  new Request("https://superii.site/file", { method: "HEAD" }),
  "qwen3",
  file,
  upstream,
);
assert.equal(fetchCount, 0);
assert.equal(head.headers.get("content-length"), "16");
assert.equal((await head.arrayBuffer()).byteLength, 0);
const full = await streamOllamaFile(
  new Request("https://superii.site/file"),
  "qwen3",
  file,
  upstream,
);
assert.match(full.headers.get("content-disposition"), /qwen3-8b-model\.gguf/);
assert.match(full.headers.get("cache-control"), /no-store/);
assert.deepEqual(new Uint8Array(await full.arrayBuffer()), payload);
for (const [range, expected] of [
  ["bytes=4-8", "abcde"],
  ["bytes=12-", "ijkl"],
  ["bytes=-3", "jkl"],
]) {
  const response = await streamOllamaFile(
    new Request("https://superii.site/file", { headers: { range } }),
    "qwen3",
    file,
    upstream,
  );
  assert.equal(response.status, 206);
  assert.equal(await response.text(), expected);
}
for (const range of [
  "bytes=20-",
  "bytes=2-1",
  "bytes=-0",
  "bytes=0-1,4-5",
  "nonsense",
])
  assert.equal(
    (
      await streamOllamaFile(
        new Request("https://superii.site/file", { headers: { range } }),
        "qwen3",
        file,
        upstream,
      )
    ).status,
    416,
  );
const changed = await streamOllamaFile(
  new Request("https://superii.site/file", {
    headers: { range: "bytes=4-", "if-range": "old" },
  }),
  "qwen3",
  file,
  upstream,
);
assert.equal(changed.status, 200);
await changed.body.cancel();
let deniedCalls = 0;
await assert.rejects(
  streamOllamaFile(
    new Request("https://superii.site/file"),
    "qwen3",
    file,
    async () => {
      deniedCalls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  ),
  /destination/,
);
assert.equal(deniedCalls, 1);
await assert.rejects(
  streamOllamaFile(
    new Request("https://superii.site/file"),
    "qwen3",
    file,
    async () =>
      new Response("bad", { status: 200, headers: { "content-length": "3" } }),
  ),
  /deliver/,
);
let cancelled = false;
const streaming = await streamOllamaFile(
  new Request("https://superii.site/file"),
  "qwen3",
  file,
  async () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-length": "16" } },
    ),
);
assert.equal(streaming.bodyUsed, false);
await streaming.body.cancel();
assert.equal(cancelled, true);
console.log(
  `OK: ${catalogue.models.length} source entries; strict manifests and destinations, proper filenames, HEAD without weights, byte ranges/resume, upstream failure and streaming cancellation.`,
);
