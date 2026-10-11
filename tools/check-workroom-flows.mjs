import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { queryDatabase as db } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, ".."),
  bundle = join(root, "node_modules", `.workroom-flow-${process.pid}.mjs`);
const definitions = {
  rooms: "src/pages/api/workrooms/index.ts",
  room: "src/pages/api/workrooms/[id].ts",
  work: "src/pages/mcp/work.ts",
  types: "src/lib/workrooms.ts",
};
await build({
  stdin: {
    contents: Object.entries(definitions)
      .map(
        ([name, path]) =>
          `export * as ${name} from ${JSON.stringify(resolve(root, path))};`,
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
      name: "isolated-workrooms",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
        b.onResolve({ filter: /^agents\/mcp\/server$/ }, () => ({
          path: "transport",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          resolveDir: root,
          contents: `import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';export function createMcpHandler(createServer){return {async fetch(request){const server=createServer();const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);}}}`,
        }));
      },
    },
  ],
});
const routes = await import(pathToFileURL(bundle).href);
const alice = "workroom_alice",
  bob = "workroom_bob";
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
          firstName: user === alice ? "Alex" : "Sam",
          lastName: "Creator",
          emailAddresses: [],
          primaryEmailAddressId: null,
          imageUrl: null,
        }
      : null,
});
let server,
  origin,
  preview = false,
  calls = 0;
async function dispatch(request) {
  const url = new URL(request.url),
    id = url.pathname.split("/").at(-1),
    user = request.headers.get("x-test-user") ?? (preview ? alice : null);
  if (url.pathname === "/mcp/work")
    return routes.work.ALL({ request, url, locals: locals(null), params: {} });
  if (url.pathname.startsWith("/api/workrooms")) {
    const route =
      url.pathname === "/api/workrooms" ? routes.rooms : routes.room;
    return (
      route[request.method]?.({
        request,
        url,
        locals: locals(user),
        params: { id },
      }) ?? new Response("", { status: 405 })
    );
  }
  if (preview) {
    const target = new URL(request.url);
    target.host = "127.0.0.1:4328";
    if (url.pathname === "/account") target.pathname = "/qa-workroom-hub";
    return fetch(target, { redirect: "manual" });
  }
  return new Response("", { status: 404 });
}
async function json(path, body, user = alice, headers = {}) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      accept: "application/json, text/event-stream",
      ...(body ? { "content-type": "application/json", origin } : {}),
      ...(user ? { "x-test-user": user } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  calls++;
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json(),
  };
}
async function ok(path, body, user = alice) {
  const result = await json(path, body, user);
  assert(result.status < 300, JSON.stringify(result));
  return result.data;
}
let org;
try {
  server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const response = await dispatch(
        new Request(origin + req.url, {
          method: req.method,
          headers: req.headers,
          ...(body.length ? { body, duplex: "half" } : {}),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error.message);
      res.writeHead(500);
      res.end("{}");
    }
  });
  await new Promise((resolve) =>
    server.listen(
      process.env.SUPERII_WORKROOM_PREVIEW === "1" ? 4338 : 0,
      "127.0.0.1",
      resolve,
    ),
  );
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await json("/api/workrooms", undefined, null)).status, 401);
  await ok("/api/workrooms");
  await ok("/api/workrooms", undefined, bob);
  const profiles = await db(
    `select id,handle,clerk_user_id from app.profiles where clerk_user_id in ('${alice}','${bob}')`,
    null,
    true,
  );
  const a = profiles.find((p) => p.clerk_user_id === alice),
    b = profiles.find((p) => p.clerk_user_id === bob);
  await db(
    `update app.profiles set is_public=true where id='${b.id}' returning id`,
    null,
    true,
  );
  const doc = routes.types.roomDocument.parse({
    title: "Evaluate the multilingual dataset",
    kind: "dataset",
    goal: "Check coverage and record missing languages",
    acceptance: "A documented comparison with source evidence",
    next_action: "Open the data and inspect a sample",
    source_url: "https://github.com/example/data",
  });
  const payload = {
    creation_key: randomUUID(),
    organization_id: null,
    repository_id: null,
    document: doc,
  };
  assert.equal(
    (
      await json("/api/workrooms", payload, alice, {
        origin: "https://elsewhere.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await json("/api/workrooms", {
        ...payload,
        document: {
          ...doc,
          source_url: "https://example.com/?access_token=secret",
        },
      })
    ).status,
    422,
  );
  const created = await ok("/api/workrooms", payload),
    path = `/api/workrooms/${created.id}`;
  assert.equal((await ok("/api/workrooms", payload)).id, created.id);
  assert.equal(
    (
      await json("/api/workrooms", {
        ...payload,
        document: { ...doc, title: "Changed retry" },
      })
    ).status,
    409,
  );
  assert.equal((await json(path, undefined, bob)).status, 404);
  assert.equal((await json(path, undefined, null)).status, 401);
  assert.match(
    (await json(path)).headers.get("cache-control"),
    /private.*no-store/,
  );
  let room = await ok(path);
  assert.equal(room.can_edit, true);
  assert.equal(room.status, "active");
  assert.equal(room.entries.length, 0);
  assert.equal(
    (
      await json(path + "?action=save", {
        version: room.version,
        document: doc,
        status: "complete",
        reviewed_entry_id: null,
      })
    ).status,
    422,
  );
  await assert.rejects(
    db("select * from app.workrooms", { actorKind: "clerk", clerkUserId: bob }),
  );
  await assert.rejects(
    db(`select app.workroom_snapshot('${created.id}')`, {
      actorKind: "clerk",
      clerkUserId: bob,
    }),
  );
  await ok(path + "?action=share", { handle: b.handle, role: "viewer" });
  assert.equal((await ok(path, undefined, bob)).can_edit, false);
  const entry = {
    creation_key: randomUUID(),
    document: {
      kind: "result",
      body: "Sample inspected; the missing language is documented.",
      url: "https://example.com/evidence",
      sha256: "",
    },
  };
  assert.equal((await json(path + "?action=entry", entry, bob)).status, 403);
  await ok(path + "?action=share", { handle: b.handle, role: "editor" });
  room = await ok(path + "?action=entry", entry, bob);
  assert.equal(room.status, "review");
  assert.equal(room.entries.length, 1);
  assert.equal(
    (await ok(path + "?action=entry", entry, bob)).entries.length,
    1,
  );
  assert.equal(
    (
      await json(
        path + "?action=entry",
        { ...entry, document: { ...entry.document, body: "Different retry" } },
        bob,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await json(path + "?action=save", {
        version: 1,
        document: doc,
        status: "active",
        reviewed_entry_id: null,
      })
    ).status,
    409,
  );
  room = await ok(path + "?action=save", {
    version: room.version,
    document: doc,
    status: "complete",
    reviewed_entry_id: room.entries[0].id,
  });
  assert.equal(room.status, "complete");
  await db(
    `update app.profiles set is_public=false where id='${b.id}' returning id`,
    null,
    true,
  );
  await ok(path + "?action=share", { handle: b.handle, role: "remove" });
  assert.equal((await json(path, undefined, bob)).status, 404);
  // Every audience uses the same contract; none needs a company.
  for (const kind of routes.types.workKinds) {
    const item = await ok("/api/workrooms", {
      ...payload,
      creation_key: randomUUID(),
      document: { ...doc, title: `${routes.types.kindNames[kind]} work`, kind },
    });
    const saved = await ok(`/api/workrooms/${item.id}`);
    assert.equal(saved.document.kind, kind);
    assert(routes.types.roomActions(saved).length);
    assert.equal(routes.types.workroomHandoff(saved).agent_access, null);
  }
  // Agent fixtures are private and local to this disposable PostgreSQL container.
  const actor = { actorKind: "clerk", clerkUserId: alice, profileId: a.id };
  org = (
    await db(
      `select app.create_organization('${a.id}','workroom-test-team','company','Workroom test team',null,null,null,null,null,'[]'::jsonb) as id`,
      actor,
    )
  )[0].id;
  const repository = (
    await db(
      `select * from app.create_repository_with_revision('${a.id}','${org}','dataset','workroom-data','Test dataset','Local fixture data','mit',null,null,null,'# Data','{}'::jsonb)`,
      actor,
    )
  )[0];
  const otherRepository = (
    await db(
      `select * from app.create_repository_with_revision('${a.id}','${org}','model','workroom-model','Test model','Local fixture model','mit',null,null,null,'# Model','{}'::jsonb)`,
      actor,
    )
  )[0];
  const team = await ok("/api/workrooms", {
    ...payload,
    creation_key: randomUUID(),
    organization_id: org,
    repository_id: repository.repository_id,
  });
  const agent = (
    await db(
      `select * from app.create_agent_identity('${a.id}','${org}','workroom-test-agent','Workroom test agent','','other',null,false)`,
      actor,
    )
  )[0];
  const token =
      "sii_agent_" + createHash("sha256").update(randomUUID()).digest("hex"),
    hash = createHash("sha256").update(token).digest("hex");
  await db(
    `insert into app.agent_access_tokens(agent_identity_id,created_by_profile_id,token_prefix,token_hash,scopes,repository_id,max_actions,expires_at) values('${agent.agent_identity_id}','${a.id}','${token.slice(0, 18)}','${hash}',array['workroom:read','workroom:report'],'${repository.repository_id}',1,now()+interval '1 day') returning id`,
    null,
    true,
  );
  async function tool(name, args, credential = token) {
    const result = await json(
      "/mcp/work",
      {
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      },
      null,
      { authorization: `Bearer ${credential}` },
    );
    return result;
  }
  function value(result) {
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(
      result.data.result?.isError,
      undefined,
      JSON.stringify(result.data),
    );
    return JSON.parse(result.data.result.content[0].text);
  }
  const input = {
    repository_id: repository.repository_id,
    workroom_id: team.id,
  };
  assert.equal(value(await tool("get_workroom", input)).id, team.id);
  const listed = value(
    await tool("get_workroom", { repository_id: repository.repository_id }),
  );
  assert.equal(listed.rooms[0].id, team.id);
  assert.equal(listed.next_before, null);
  assert(
    (
      await tool("get_workroom", {
        repository_id: repository.repository_id,
        before: created.id,
      })
    ).data.result.isError,
  );
  await db(
    `insert into app.workrooms(owner_profile_id,organization_id,repository_id,creation_key,creation_document,document)
    select owner_profile_id,organization_id,repository_id,gen_random_uuid(),creation_document,document
    from app.workrooms cross join generate_series(1,51) where id='${team.id}' returning id`,
    null,
    true,
  );
  const pageOne = value(
    await tool("get_workroom", { repository_id: repository.repository_id }),
  );
  assert.equal(pageOne.rooms.length, 50);
  assert(pageOne.next_before);
  const pageTwo = value(
    await tool("get_workroom", {
      repository_id: repository.repository_id,
      before: pageOne.next_before,
    }),
  );
  assert.equal(pageTwo.rooms.length, 2);
  assert.equal(pageTwo.next_before, null);
  assert.equal(
    new Set([...pageOne.rooms, ...pageTwo.rooms].map((room) => room.id)).size,
    52,
  );

  assert(
    (await tool("get_workroom", { ...input, workroom_id: created.id })).data
      .result.isError,
  );
  assert(
    (
      await tool("get_workroom", {
        ...input,
        repository_id: otherRepository.repository_id,
      })
    ).data.result.isError,
  );
  const report = {
    ...input,
    creation_key: randomUUID(),
    document: {
      kind: "result",
      body: "Agent reports the schema check; this still needs member review.",
      url: "",
      sha256: "",
    },
  };
  const reported = value(await tool("report_workroom_result", report));
  assert.equal(reported.evidence, "reported");
  assert.equal(reported.workroom_status, "review");
  assert.equal(reported.receipt.action, "workroom.report");
  assert.equal(
    value(await tool("report_workroom_result", report)).replayed,
    true,
  );
  assert(
    (
      await tool("report_workroom_result", {
        ...report,
        creation_key: randomUUID(),
      })
    ).data.result.isError,
  );
  assert.equal(value(await tool("get_workroom", input)).status, "review");
  const used = (
    await db(
      `select actions_used from app.agent_access_tokens where token_hash='${hash}'`,
      null,
      true,
    )
  )[0].actions_used;
  assert.equal(used, 1);
  await db(
    `update app.agent_access_tokens set scopes=array['repository:read'] where token_hash='${hash}' returning id`,
    null,
    true,
  );
  assert.equal((await tool("get_workroom", input)).status, 403); // old scopes confer no new access
  await db(
    `update app.agent_access_tokens set scopes=array['workroom:read','workroom:report'],revoked_at=now() where token_hash='${hash}' returning id`,
    null,
    true,
  );
  assert.equal((await tool("report_workroom_result", report)).status, 401);
  const snapshots = await db(
    `select count(*) as count from app.workroom_entries where workroom_id='${team.id}'`,
    null,
    true,
  );
  assert.equal(Number(snapshots[0].count), 1);
  assert.equal(
    (await json("/api/workrooms/" + team.id, undefined, bob)).status,
    404,
  );
  const relation = await db(
    "select relname,relrowsecurity from pg_class where oid in ('app.workrooms'::regclass,'app.workroom_entries'::regclass,'app.workroom_collaborators'::regclass)",
    null,
    true,
  );
  assert(relation.every((row) => row.relrowsecurity));
  console.log(
    `Workrooms passed: ${calls} HTTP checks, all 8 work kinds, personal/team isolation, collaborator removal, stale edits, retry conflicts, result review, real MCP reports, narrow scopes, repository binding, atomic action limit, exact replay and revocation.`,
  );
  if (process.env.SUPERII_WORKROOM_PREVIEW === "1") {
    await writeFile(
      join(root, "src/pages/qa-workroom-hub.astro"),
      `---\nimport BaseLayout from '@/layouts/BaseLayout.astro';import WorkroomHub from '@/components/WorkroomHub.astro';\n---\n<BaseLayout title="Local Workspace fixture"><main class="shell" style="padding-block:2rem"><h1>Workspace</h1><WorkroomHub /></main></BaseLayout>`,
    );
    preview = true;
    console.log(
      `Local fixture ready at ${origin}/account; no production database is connected.`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  // The parent test runner destroys its isolated database, including immutable receipts.
  await rm(bundle, { force: true });
  await rm(join(root, "src/pages/qa-workroom-hub.astro"), { force: true });
}
