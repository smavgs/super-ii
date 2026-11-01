// Metadata only. This script never fetches model layers or writes to a database.
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const source =
  "https://raw.githubusercontent.com/smavgs/ailocalclick/main/src/data/models.json";
const registry = "https://registry.ollama.ai/v2/library/";
async function read(url, max = 1_000_000) {
  let response;
  for (let redirects = 0; ; redirects++) {
    response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
    });
    if (![301, 302, 307, 308].includes(response.status)) break;
    const next = new URL(response.headers.get("location"), url);
    await response.body?.cancel();
    if (
      redirects >= 3 ||
      next.protocol !== "https:" ||
      !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(next.hostname)
    )
      throw new Error("unsupported redirect");
    url = next.href;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("metadata too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
const original = await read(source);
const input = JSON.parse(original);
if (
  !Array.isArray(input.models) ||
  input.models.length < 1 ||
  input.models.length > 1000
)
  throw new Error("invalid catalogue");
const checkedAt = new Date().toISOString();
const output = [];
let position = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (;;) {
      const index = position++;
      if (index >= input.models.length) break;
      const model = input.models[index];
      if (
        !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(model.slug) ||
        model.officialUrl !== `https://ollama.com/library/${model.slug}`
      )
        throw new Error("invalid source model");
      const item = {
        slug: model.slug,
        title: String(model.name).slice(0, 200),
        summary: String(model.description).slice(0, 2000),
        sourceUrl: model.officialUrl,
        capabilities: model.capabilities.slice(0, 20),
        sizes: model.sizes.slice(0, 100),
        sourceUpdatedAt: model.updatedAt,
        checkedAt,
        status: "unavailable",
        manifest: null,
        config: null,
      };
      try {
        const raw = await read(
          `${registry}${model.slug}/manifests/latest`,
          128000,
        );
        const manifest = JSON.parse(raw);
        if (
          manifest.schemaVersion !== 2 ||
          !Array.isArray(manifest.layers) ||
          manifest.layers.length > 256
        )
          throw new Error("invalid manifest");
        item.manifest = manifest;
        item.manifestDigest =
          "sha256:" + createHash("sha256").update(raw).digest("hex");
        item.status = manifest.layers.some(
          (layer) => layer.mediaType === "application/vnd.ollama.image.model",
        )
          ? "available"
          : "cloud";
        const config = manifest.config;
        if (
          config &&
          /^sha256:[a-f0-9]{64}$/.test(config.digest) &&
          config.size < 32000
        ) {
          try {
            item.config = JSON.parse(
              await read(
                `${registry}${model.slug}/blobs/${config.digest}`,
                32000,
              ),
            );
          } catch {
            /* optional metadata */
          }
        }
      } catch (error) {
        item.error = error.message;
      }
      output[index] = item;
      if ((index + 1) % 25 === 0)
        console.log(`Metadata ${index + 1}/${input.models.length}`);
    }
  }),
);
const catalogue = {
  source,
  sourceSha256: createHash("sha256").update(original).digest("hex"),
  upstream: input.source,
  checkedAt,
  models: output,
};
await writeFile(
  new URL("../src/data/ollama-catalog.json", import.meta.url),
  JSON.stringify(catalogue, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    total: output.length,
    available: output.filter((m) => m.status === "available").length,
    cloud: output.filter((m) => m.status === "cloud").length,
    unavailable: output
      .filter((m) => m.status === "unavailable")
      .map((m) => m.slug),
  }),
);
