import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve, join } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { queryDatabase } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, "..");
const bundle = join(root, "node_modules", `.ollama-flows-${process.pid}.mjs`);
await build({
  stdin: {
    resolveDir: root,
    contents: `export * as download from './src/pages/api/ollama/[id]/download.ts';export * as edit from './src/pages/api/ollama/[id]/index.ts';`,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "isolated-db",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
      },
    },
  ],
});
const routes = await import(pathToFileURL(bundle));
const owner = (q) => queryDatabase(q, null, true);
const digest = "sha256:" + "a".repeat(64),
  configDigest = "sha256:" + "b".repeat(64);
const locals = (user) => ({
  __testActor: user
    ? { actorKind: "clerk", clerkUserId: user }
    : { actorKind: "public" },
  auth: () => ({ userId: user ?? null }),
  currentUser: async () =>
    user
      ? {
          id: user,
          username: user,
          firstName: "Ollama",
          lastName: "Test",
          emailAddresses: [],
          primaryEmailAddressId: null,
          imageUrl: null,
        }
      : null,
});
const originalFetch = globalThis.fetch;
let remoteCalls = 0;
let item;
try {
  const users = await owner(
    `insert into app.profiles(clerk_user_id,handle,display_name,is_public) values ('ollama_flow_alice','ollama-flow-alice','Alice',true),('ollama_flow_bob','ollama-flow-bob','Bob',true) returning id,clerk_user_id`,
  );
  const alice = users.find((x) => x.clerk_user_id === "ollama_flow_alice").id;
  const rows =
    await owner(`insert into app.external_catalog_items(owner_profile_id,provider,kind,provider_repo_id,provider_namespace,provider_slug,source_url,title,file_count,total_size_bytes)
 values('${alice}','ollama','model','library/qwen3','library','qwen3','https://ollama.com/library/qwen3','Qwen 3',1,16) returning id`);
  item = rows[0].id;
  globalThis.fetch = async (url, options) => {
    remoteCalls++;
    assert.match(
      String(url),
      /^https:\/\/registry\.ollama\.ai\/v2\/library\/qwen3\//,
    );
    if (String(url).includes("/manifests/"))
      return Response.json({
        schemaVersion: 2,
        format: "gguf",
        config: { mediaType: "config", digest: configDigest, size: 2 },
        layers: [
          { mediaType: "application/vnd.ollama.image.model", digest, size: 16 },
        ],
      });
    return new Response("GGUFabcdefghijkl", {
      headers: { "content-length": "16" },
    });
  };
  const download = async (
    user = null,
    method = "GET",
    query = `tag=latest&file=${digest}`,
  ) => {
    const url = new URL(
      `http://localhost/api/ollama/${item}/download?${query}`,
    );
    return routes.download[method]({
      params: { id: item },
      locals: locals(user),
      request: new Request(url, { method }),
      url,
    });
  };
  const edit = async (user, body, origin = "http://localhost") =>
    routes.edit.PATCH({
      params: { id: item },
      locals: locals(user),
      request: new Request(`http://localhost/api/ollama/${item}`, {
        method: "PATCH",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  const body = {
    title: "Owner title",
    summary: "Owner summary",
    card_markdown: "# Owner card",
  };
  assert.equal((await edit(null, body)).status, 401);
  assert.equal((await edit("ollama_flow_bob", body)).status, 403);
  assert.equal(
    (await edit("ollama_flow_alice", body, "https://evil.example")).status,
    403,
  );
  assert.equal((await edit("ollama_flow_alice", body)).status, 200);
  const saved = (
    await owner(
      `select title,card_markdown,source_metadata,source_url from app.external_catalog_items where id='${item}'`,
    )
  )[0];
  assert.equal(saved.title, body.title);
  assert.equal(saved.source_metadata.curator_edited, true);
  assert.equal(saved.source_url, "https://ollama.com/library/qwen3");
  const head = await download(null, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(remoteCalls, 1);
  assert.equal(head.headers.get("content-length"), "16");
  assert.match(
    head.headers.get("content-disposition"),
    /qwen3-latest-model.gguf/,
  );
  const response = await download();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "GGUFabcdefghijkl");
  assert.equal(
    (await download(null, "GET", `tag=../../private&file=${digest}`)).status,
    400,
  );
  assert.equal(
    (await download(null, "GET", `tag=latest&file=sha256:${"f".repeat(64)}`))
      .status,
    409,
  );
  const callsBefore = remoteCalls;
  await owner(
    `update app.profiles set is_public=false where id='${alice}' returning id`,
  );
  assert.equal((await download()).status, 404);
  assert.equal(remoteCalls, callsBefore);
  await owner(
    `update app.profiles set is_public=true where id='${alice}' returning id`,
  );
  await owner(
    `update app.external_catalog_items set status='removed' where id='${item}' returning id`,
  );
  assert.equal((await download()).status, 404);
  assert.equal((await edit("ollama_flow_alice", body)).status, 403);
  const seedPath = join(
    root,
    "node_modules",
    `.ollama-seed-${process.pid}.sql`,
  );
  try {
    const prepare = spawnSync(
      process.execPath,
      [
        join(root, "tools/seed-ollama-catalog.mjs"),
        "--owner",
        "ollama-flow-alice",
        "--out",
        seedPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(prepare.status, 0, prepare.stderr);
    const seed = await readFile(seedPath, "utf8");
    const apply = (input = seed) => {
      const result = spawnSync(
        "docker",
        [
          "exec",
          "-i",
          process.env.SUPERII_TEST_PG_CONTAINER,
          "psql",
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "superii_test",
        ],
        { input, encoding: "utf8", maxBuffer: 2000000 },
      );
      assert.equal(result.status, 0, result.stderr);
    };
    apply();
    const seeded = await owner(
      `select id,provider_slug,status from app.external_catalog_items where owner_profile_id='${alice}' and provider='ollama'`,
    );
    assert.equal(seeded.length, 266);
    assert.equal(
      seeded.find((row) => row.provider_slug === "qwen3").status,
      "removed",
    );
    const editable = seeded.find((row) => row.status === "active");
    const removedId = item;
    item = editable.id;
    assert.equal(
      (
        await edit("ollama_flow_alice", {
          ...body,
          title: "Preserved curator title",
        })
      ).status,
      200,
    );
    apply(
      (await readFile(
        join(root, "database/migrations/0036_quick_drive_links.sql"),
        "utf8",
      )) +
        "\n" +
        (await readFile(
          join(root, "database/migrations/0044_ollama_external_models.sql"),
          "utf8",
        )),
    );
    apply();
    assert.equal(
      (
        await owner(
          `select count(*)::integer count from app.external_catalog_items where owner_profile_id='${alice}' and provider='ollama'`,
        )
      )[0].count,
      266,
    );
    assert.equal(
      (
        await owner(
          `select title from app.external_catalog_items where id='${item}'`,
        )
      )[0].title,
      "Preserved curator title",
    );
    item = removedId;
  } finally {
    await rm(seedPath, { force: true });
  }
  console.log(
    "OK: real Ollama routes with signed Postgres roles; public downloads, body-free HEAD, owner-only editing, cross-origin rejection, stale files, private profiles and removed listings.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await owner(
    "delete from app.profiles where clerk_user_id in ('ollama_flow_alice','ollama_flow_bob') returning id",
  );
  await rm(bundle, { force: true });
}
