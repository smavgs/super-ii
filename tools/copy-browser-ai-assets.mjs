#!/usr/bin/env node
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/onnxruntime-web/dist');
const target = resolve(root, 'public/runtime-assets/wasm');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const entries = await readdir(source, { withFileTypes: true });
const wasmFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.wasm'));
if (!wasmFiles.length) {
  throw new Error('No local ONNX Runtime WASM files were found.');
}
for (const file of wasmFiles) {
  await cp(resolve(source, file.name), resolve(target, file.name));
}
console.log(`OK: copied ${wasmFiles.length} local browser inference WASM file(s)`);
