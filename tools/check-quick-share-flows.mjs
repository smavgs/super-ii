import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { packageFixture } from "./lib/quick-package-fixture.mjs";
import { queryDatabase } from "./lib/connection-test-db.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = join(
  root,
  "node_modules",
  `.quick-share-flow-${process.pid}.mjs`,
);
const definitions = {
  create: "src/pages/api/repositories/index.ts",
  status: "src/pages/api/repositories/[repositoryId]/quick-status.ts",
  download: "src/pages/api/repositories/[repositoryId]/download.ts",
  drive: "src/pages/api/bridge/drive-links.ts",
};
await build({
  stdin: {
    contents: Object.entries(definitions)
      .map(
        ([key, file]) =>
          `export * as ${key} from ${JSON.stringify(resolve(root, file))};`,
      )
      .join("\n"),
    resolveDir: root,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  tsconfig: join(root, "tsconfig.json"),
  logLevel: "silent",
  plugins: [
    {
      name: "isolated-quick-share",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
        b.onResolve({ filter: /^(?:@\/lib\/runtime|\.\/runtime)$/ }, () => ({
          path: "fixture-runtime",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export async function runtimeFetch(locals,path,options){return globalThis.__quickFixture(path,options);}",
        }));
      },
    },
  ],
});
const routes = await import(pathToFileURL(bundle).href);
const alice = "quick_flow_alice",
  bob = "quick_flow_bob";
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
          firstName: "Quick",
          lastName: "Test",
          emailAddresses: [],
          primaryEmailAddressId: null,
          imageUrl: null,
        }
      : null,
});
const request = (method, body, path, headers) =>
  new Request(`http://localhost${path}`, {
    method,
    headers:
      headers ??
      (method === "GET" || method === "HEAD"
        ? { "sec-fetch-site": "same-origin" }
        : { origin: "http://localhost", "content-type": "application/json" }),
    ...(["GET", "HEAD"].includes(method) ? {} : { body: JSON.stringify(body) }),
  });
const owner = (q) => queryDatabase(q, null, true);
const member = (q, user = alice) =>
  queryDatabase(q, { actorKind: "clerk", clerkUserId: user });
let repositoryId;
try {
  const result = await routes.create.POST({
    locals: locals(alice),
    request: request(
      "POST",
      { kind: "dataset", slug: "quick-fixture", title: "Quick fixture" },
      "/api/repositories",
    ),
  });
  assert.equal(result.status, 201, await result.clone().text());
  const created = await result.json();
  repositoryId = created.repository_id;
  const params = { repositoryId };
  const statusPath = `/api/repositories/${repositoryId}/quick-status`;
  const status = (user, headers) =>
    routes.status.GET({
      locals: locals(user),
      params,
      request: request("GET", null, statusPath, headers),
    });
  assert.equal((await status(null)).status, 401);
  assert.equal((await status(bob)).status, 404);
  assert.equal(
    (await status(alice, { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  let state = await (await status(alice)).json();
  assert.equal(state.status, "draft");
  assert.deepEqual(state.files, []);
  const content = Buffer.from("name,value\nhello,42\n");
  const sha = createHash("sha256").update(content).digest("hex");
  await owner(
    `insert into app.repository_files(repository_id,revision_id,path,size_bytes,mime_type,sha256,storage_key,storage_state,scan_status,created_by) values ('${repositoryId}','${created.revision_id}','data/part.csv',${content.length},'text/csv','${sha}','objects/${sha}','available','clean','quick-test') returning id`,
  );
  state = await (await status(alice)).json();
  assert.equal(state.files[0].sha256, sha);
  let fetched = 0;
  globalThis.__quickFixture = async (path, options) => {
    fetched++;
    assert.equal(
      path,
      `/v1/repositories/${repositoryId}/revisions/${created.revision_id}/download?commit=${"d".repeat(64)}`,
    );
    assert.ok(options.signal);
    return packageFixture(options, content);
  };
  const commit = "d".repeat(64);
  const path = `/api/repositories/${repositoryId}/download?revision=${commit}`;
  const download = (user = null, method = "GET", headers = {}) =>
    routes.download[method]({
      locals: locals(user),
      params,
      request: request(method, null, path, headers),
    });
  assert.equal(
    (await download()).status,
    404,
    "draft must not download publicly",
  );
  // Fixture-only publication: signed automatic policy decisions are tested by
  // interaction_smoke.sql. This test exercises the real web boundary and RLS.
  await owner(
    `update app.repository_revisions set status='published',published_at=now(),file_count=1,total_size_bytes=${content.length},manifest_sha256=repeat('c',64),commit_sha='${commit}',manifest='[{"path":"data/part.csv"}]'::jsonb where id='${created.revision_id}' returning id`,
  );
  await owner(
    `update app.repositories set status='published',published_at=now(),latest_revision_id='${created.revision_id}' where id='${repositoryId}' returning id`,
  );
  const head = await download(null, "HEAD");
  assert.equal(head.status, 200, await head.clone().text());
  assert.equal(fetched, 1, "HEAD uses exactly one runtime request");
  assert.equal(head.body, null);
  assert.equal(head.headers.get("content-type"), "application/x-tar");
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  const full = await download();
  assert.equal(full.status, 200);
  const all = Buffer.from(await full.arrayBuffer());
  assert.equal(all.length, Number(head.headers.get("content-length")));
  assert.ok(all.includes(content));
  assert.equal(fetched, 2, "GET uses exactly one runtime request");
  const partial = await download(null, "GET", {
    range: "bytes=510-530",
    "if-range": head.headers.get("etag"),
  });
  assert.equal(partial.status, 206);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    all.subarray(510, 531),
  );
  assert.equal(
    (await download(null, "HEAD", { range: "bytes=999999999-" })).status,
    416,
  );
  const changed = await download(null, "HEAD", {
    range: "bytes=0-1",
    "if-range": '"wrong"',
  });
  assert.equal(changed.status, 200);
  assert.equal(
    changed.headers.get("content-length"),
    head.headers.get("content-length"),
  );
  await owner(
    `update app.repositories set visibility='private' where id='${repositoryId}' returning id`,
  );
  assert.equal((await download()).status, 404);
  assert.equal((await download(bob)).status, 404);
  const authorized = await download(alice, "HEAD", {
    origin: "http://localhost",
  });
  assert.equal(authorized.status, 200, await authorized.clone().text());
  await owner(
    `update app.repositories set visibility='public' where id='${repositoryId}' returning id`,
  );
  globalThis.__quickFixture = async () =>
    new Response("unavailable", { status: 503 });
  const interrupted = await download();
  assert.equal(
    interrupted.status,
    503,
    "upstream failure must not masquerade as a successful package",
  );

  const drivePath = "/api/bridge/drive-links";
  const data = {
    kind: "model",
    drive_url:
      "https://drive.google.com/file/d/abcdefghijklmnopqrst/view?usp=sharing",
    title: "Shared model",
    format: "gguf",
    license: "mit",
    basis: "original",
    confirmed: true,
    download_confirmed: true,
  };
  const share = (user = alice, body = data, headers) =>
    routes.drive.POST({
      locals: locals(user),
      request: request("POST", body, drivePath, headers),
    });
  assert.equal((await share(null)).status, 401);
  assert.equal(
    (
      await share(alice, data, {
        origin: "https://attacker.invalid",
        "content-type": "application/json",
      })
    ).status,
    403,
  );
  for (const body of [
    { ...data, drive_url: "https://evil.invalid/file" },
    { ...data, confirmed: false },
    { ...data, download_confirmed: false },
    { ...data, format: "csv" },
    { ...data, basis: "permission", source_url: "http://source.invalid/" },
  ])
    assert.equal((await share(alice, body)).status, 422);
  const first = await share();
  assert.equal(first.status, 201, await first.clone().text());
  const linked = await first.json();
  const retry = await share();
  assert.equal(
    (await retry.json()).id,
    linked.id,
    "lost response retry must reuse the link",
  );
  let links = await queryDatabase(
    `select id,provider,source_revision,external_identity_id,source_metadata from app.external_catalog_items where id='${linked.id}'`,
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].source_revision, null);
  assert.equal(links[0].external_identity_id, null);
  assert.equal(links[0].source_metadata.verification, "member-declared");
  assert.equal(
    (
      await member(
        `select app.unlink_external_catalog_item('${linked.id}') as removed`,
        bob,
      )
    )[0].removed,
    false,
  );
  await owner(
    `update app.profiles set is_public=false where clerk_user_id='${alice}' returning id`,
  );
  assert.equal((await share()).status, 422);
  assert.equal(
    (
      await queryDatabase(
        `select id from app.external_catalog_items where id='${linked.id}'`,
      )
    ).length,
    0,
  );
  await owner(
    `update app.profiles set is_public=true where clerk_user_id='${alice}' returning id`,
  );
  assert.equal(
    (
      await member(
        `select app.unlink_external_catalog_item('${linked.id}') as removed`,
      )
    )[0].removed,
    true,
  );
  assert.equal(
    (
      await queryDatabase(
        `select id from app.external_catalog_items where id='${linked.id}'`,
      )
    ).length,
    0,
  );
  const relink = await share();
  assert.equal(relink.status, 201);
  assert.notEqual((await relink.json()).id, linked.id);
  await assert.rejects(
    () =>
      owner(
        `update app.external_catalog_items set provider='huggingface',source_url='https://huggingface.co/test/model' where id='${linked.id}' returning id`,
      ),
    "HF still requires verified identity and revision",
  );
  console.log(
    "OK: real quick-status auth/RLS; published-only complete download, HEAD/ranges/private authorization/upstream failure; Drive origin/rights/format checks, retry reuse, owner removal, private-profile visibility, and retained HF identity constraints",
  );
} finally {
  delete globalThis.__quickFixture;
  if (repositoryId)
    await owner(
      `delete from app.repositories where id='${repositoryId}' returning id`,
    );
  await owner(
    `delete from app.profiles where clerk_user_id in ('${alice}','${bob}') returning id`,
  );
  await rm(bundle, { force: true });
}
