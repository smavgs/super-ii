import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dir = await mkdtemp(join(tmpdir(), "superii-package-"));
try {
  await build({
    stdin: {
      contents: `export * from './src/lib/quick-share';`,
      resolveDir: root,
    },
    outfile: join(dir, "package.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { validPackagePath, canonicalDriveLink, detectShareFormat, quickSlug } =
    await import(pathToFileURL(join(dir, "package.mjs")));
  assert.equal(detectShareFormat("model", ["model.gguf"]), "gguf");
  assert.equal(detectShareFormat("model", ["model.safetensors"], "mlx"), "mlx");
  assert.equal(
    detectShareFormat("dataset", ["part-1.parquet", "part-2.parquet"]),
    "parquet",
  );
  assert.equal(
    detectShareFormat("dataset", ["data.csv", "metadata.json"]),
    "other",
  );
  assert.equal(
    quickSlug("My model", "0fa12b34-5678-4321-9876-abcdefabcdef"),
    "my-model-0fa12b3456",
  );
  const id = "abcdefghijklmnopqrst";
  assert.equal(
    canonicalDriveLink(
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    ),
    `https://drive.google.com/file/d/${id}/view`,
  );
  assert.equal(
    canonicalDriveLink(
      `https://drive.google.com/drive/u/0/folders/${id}?resourcekey=0-abc`,
    ),
    `https://drive.google.com/drive/folders/${id}?resourcekey=0-abc`,
  );
  assert.equal(
    canonicalDriveLink(`https://drive.google.com/open?id=${id}`),
    `https://drive.google.com/file/d/${id}/view`,
  );
  for (const url of [
    "http://drive.google.com/file/d/" + id,
    "https://drive.google.com.evil.invalid/file/d/" + id,
    "https://user:pass@drive.google.com/file/d/" + id,
    "https://drive.google.com:444/file/d/" + id,
    "https://127.0.0.1/",
    "javascript:alert(1)",
    "https://drive.google.com/file/d/short",
    `https://drive.google.com/file/d/${id}/view?resourcekey=%0A`,
  ])
    assert.equal(canonicalDriveLink(url), null, url);

  for (const path of [
    "../bad",
    "/absolute",
    "safe//x",
    "safe/./x",
    "C:drive",
    "file\\evil",
    "x\u0000y",
    " trimmed ",
  ])
    assert.equal(validPackagePath(path), false, path);
  assert.equal(validPackagePath("数据/model.safetensors"), true);
  console.log(
    "OK: quick upload format detection, safe paths, stable draft slugs, and canonical Drive links",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
