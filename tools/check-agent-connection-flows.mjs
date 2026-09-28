import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { queryDatabase } from "./lib/connection-test-db.mjs";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "superii-connection-test-"));
const bundle = join(
  root,
  "node_modules",
  `.superii-connection-test-${process.pid}.mjs`,
);
const previewPage = join(root, "src/pages/qa-connect-preview.astro");
const routeFiles = {
  oauth: "src/pages/api/oauth/[operation].ts",
  manage: "src/pages/api/agent-connections/[operation].ts",
  status: "src/pages/api/agent-connections/status.ts",
  metadata: "src/pages/.well-known/oauth-authorization-server.ts",
  protected: "src/pages/.well-known/oauth-protected-resource/mcp/[resource].ts",
  work: "src/pages/mcp/work.ts",
  social: "src/pages/mcp/social.ts",
  agents: "src/pages/api/agents/index.ts",
  socialAgents: "src/pages/api/social/agents/index.ts",
  organizations: "src/pages/api/organizations/index.ts",
};
await build({
  stdin: {
    contents: Object.entries(routeFiles)
      .map(
        ([name, file]) =>
          `export * as ${name} from ${JSON.stringify(resolve(root, file))};`,
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
      name: "isolated-fixtures",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
        b.onResolve({ filter: /^agents\/mcp\/server$/ }, () => ({
          path: "mcp-transport",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          resolveDir: root,
          contents: `import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server'; export function createMcpHandler(createServer){return {async fetch(request){const server=createServer();const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);}}}`,
        }));
      },
    },
  ],
});
const routes = await import(pathToFileURL(bundle).href);
let origin;
let server;
let calls = 0;
let preview = false;
function localsFor(user) {
  return {
    __testActor: user
      ? { actorKind: "clerk", clerkUserId: user }
      : { actorKind: "public" },
    auth: () => ({ userId: user ?? null }),
    currentUser: async () =>
      user
        ? {
            id: user,
            username: user,
            firstName: "Connection",
            lastName: "Test",
            emailAddresses: [],
            primaryEmailAddressId: null,
            imageUrl: null,
          }
        : null,
  };
}
async function dispatch(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const actor = request.headers.get("x-test-user") ?? (preview ? alice : null);
  let route;
  let params = {};
  if (path.startsWith("/api/oauth/")) {
    route = routes.oauth.ALL;
    params.operation = path.split("/").at(-1);
  } else if (path === "/api/agent-connections/status")
    route = routes.status.GET;
  else if (path.startsWith("/api/agent-connections/")) {
    route = routes.manage.ALL;
    params.operation = path.split("/").at(-1);
  } else if (path === "/.well-known/oauth-authorization-server")
    route = routes.metadata.GET;
  else if (path.startsWith("/.well-known/oauth-protected-resource/mcp/")) {
    route = routes.protected.GET;
    params.resource = path.split("/").at(-1);
  } else if (path === "/mcp/work") route = routes.work.ALL;
  else if (path === "/mcp/social") route = routes.social.ALL;
  else if (path === "/api/agents") route = routes.agents.GET;
  else if (path === "/api/social/agents") route = routes.socialAgents.GET;
  else if (path === "/api/organizations") route = routes.organizations.GET;
  if (!route) {
    if (preview) {
      // Local-only visual fixture: all data and writes use the disposable test DB.
      const target = new URL(request.url);
      target.host = "127.0.0.1:4336";
      if (path === "/account/connect") target.pathname = "/qa-connect-preview";
      return fetch(target, { redirect: "manual" });
    }
    return new Response("not found", { status: 404 });
  }
  return route({ request, url, params, locals: localsFor(actor) });
}
async function json(
  path,
  body,
  { user, token, method = body ? "POST" : "GET", headers = {} } = {},
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      accept: "application/json, text/event-stream",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(user ? { "x-test-user": user, origin } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const data = await response.json().catch(() => ({}));
  calls++;
  return { response, data };
}
const alice = "connection-test-alice";
const bob = "connection-test-bob";
async function requestView(path, user = alice) {
  return json(
    "/api/agent-connections/request" + new URL(path, origin).search,
    undefined,
    { user },
  );
}
async function approve(path, options, user = alice, allow = true) {
  const view = await requestView(path, user);
  assert.equal(view.response.status, 200, JSON.stringify(view.data));
  return json(
    "/api/agent-connections/approve",
    { id: view.data.request.id, allow, options },
    { user },
  );
}
async function device(
  client,
  resource = "work",
  scope = "repository:read receipts:read",
) {
  const result = await json("/api/oauth/device", {
    client_id: client,
    resource: `${origin}/mcp/${resource}`,
    scope,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data;
}
async function exchange(client, request, resource = "work") {
  return json("/api/oauth/token", {
    client_id: client,
    resource: `${origin}/mcp/${resource}`,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: request.device_code,
  });
}
async function clearPoll(code) {
  await queryDatabase(
    `update app_private.agent_connection_requests set last_polled_at=null where user_code_hash=encode(public.digest('${code.replace("-", "")}','sha256'),'hex') returning id`,
    null,
    true,
  );
}
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
      process.stderr.write(`Test server: ${error.message}\n`);
      res.writeHead(500);
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let result = await json("/mcp/work", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.equal(result.response.status, 401);
  assert.match(
    result.response.headers.get("www-authenticate"),
    /resource_metadata/,
  );
  result = await json("/api/oauth/register", {
    client_name: "Test agent",
    redirect_uris: [`${origin}/callback`],
    token_endpoint_auth_method: "none",
  });
  assert.equal(result.response.status, 201);
  const client = result.data.client_id;
  result = await json("/api/oauth/register", {
    client_name: "Bad redirect",
    redirect_uris: ["http://example.com/callback"],
  });
  assert.equal(result.response.status, 400);
  const scope = "repository:read repository:create receipts:read";
  const pending = await device(client, "work", scope);
  result = await exchange(client, pending);
  assert.equal(result.data.error, "authorization_pending");
  result = await exchange(client, pending);
  assert.equal(result.data.error, "slow_down");
  const view = await requestView(pending.verification_uri_complete);
  assert.equal(view.response.status, 200);
  const options = {
    scopes: scope.split(" "),
    create_organization: true,
    organization_name: "Connection test work",
    organization_handle: "connection-test-work",
    display_name: "Test agent",
    handle: "connection-test-agent",
    expires_in_days: 7,
    max_actions: 20,
  };
  result = await json("/api/agent-connections/approve", {
    id: view.data.request.id,
    allow: true,
    options,
  });
  assert.equal(result.response.status, 403);
  result = await json(
    "/api/agent-connections/approve",
    {
      id: view.data.request.id,
      allow: true,
      options: { ...options, scopes: ["repository:submit"] },
    },
    { user: alice },
  );
  assert.equal(result.response.status, 409);
  result = await approve(pending.verification_uri_complete, options);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(!result.data.access_token);
  await clearPoll(pending.user_code);
  result = await exchange(client, pending);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const token = result.data.access_token;
  assert.equal(result.data.scope, scope);
  assert.match(token, /^sii_agent_[a-f0-9]{64}$/);
  await clearPoll(pending.user_code);
  result = await exchange(client, pending);
  assert.equal(result.data.error, "invalid_grant");
  result = await json(
    "/api/agent-connections/status?resource=work",
    undefined,
    { token },
  );
  assert.equal(result.data.status, "active");
  assert.equal(result.data.actions_remaining, 20);
  const agentId = result.data.agent_id;
  result = await json(
    "/api/agent-connections/status?resource=social",
    undefined,
    { token },
  );
  assert.equal(result.response.status, 401);
  // A real MCP SDK client exercises the live HTTP transport and actual Work callbacks.
  const sdk = new Client({ name: "connection-test-sdk", version: "1.0.0" });
  await sdk.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/work`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await sdk.listTools();
  assert.ok(tools.tools.some((t) => t.name === "get_connection_status"));
  result = await sdk.callTool({ name: "get_connection_status", arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).actions_remaining, 20);
  const draftArgs = {
    idempotency_key: "connection-test-draft-001",
    kind: "model",
    slug: "connection-test-model",
    title: "Connection test model",
    summary: "An isolated integration test draft.",
  };
  const first = await sdk.callTool({
    name: "create_draft_repository",
    arguments: draftArgs,
  });
  assert.ok(!first.isError, JSON.stringify(first));
  const retry = await sdk.callTool({
    name: "create_draft_repository",
    arguments: draftArgs,
  });
  assert.ok(!retry.isError);
  assert.equal(
    JSON.parse(first.content[0].text).receipt.id,
    JSON.parse(retry.content[0].text).receipt.id,
  );
  const draft = JSON.parse(first.content[0].text);
  const repositoryId =
    draft.result?.repository_id ?? draft.receipt?.detail?.result?.repository_id;
  result = await sdk.callTool({
    name: "get_work_status",
    arguments: { repository_id: repositoryId },
  });
  assert.ok(!result.isError, JSON.stringify(result));
  const draftStatus = JSON.parse(result.content[0].text);
  assert.equal(draftStatus.published, false);
  assert.equal(draftStatus.latest_publication_decision, null);
  // A blocked policy result must reach the requesting agent without exposing
  // the signed payload or pretending the draft is published.
  await queryDatabase(
    `insert into app.publication_keys(id,public_key,policy_sha256)
     values ('connection-test-policy','isolated-fixture',repeat('a',64)) returning id`,
    null,
    true,
  );
  await queryDatabase(
    `insert into app.publication_decisions(repository_id,revision_id,commit_sha,manifest_sha256,
      metadata_sha256,policy_version,policy_sha256,outcome,reasons,evidence,key_id,payload,payload_sha256,signature)
     select '${repositoryId}','${draftStatus.revision_id}',repeat('a',64),repeat('b',64),repeat('c',64),
       'superii-auto-publish-v1',repeat('a',64),'blocked','["missing_license"]','{}',
       'connection-test-policy',payload,encode(public.digest(payload,'sha256'),'hex'),'isolated-fixture'
     from (select jsonb_build_object('repository_id','${repositoryId}','revision_id','${draftStatus.revision_id}',
       'commit_sha',repeat('a',64),'manifest_sha256',repeat('b',64),'metadata_sha256',repeat('c',64),
       'policy_version','superii-auto-publish-v1','policy_sha256',repeat('a',64),'outcome','blocked')::text as payload) fixture
     returning id`,
    null,
    true,
  );
  result = await sdk.callTool({
    name: "get_work_status",
    arguments: {
      repository_id: repositoryId,
      revision_id: draftStatus.revision_id,
    },
  });
  assert.ok(!result.isError, JSON.stringify(result));
  const blockedStatus = JSON.parse(result.content[0].text);
  assert.equal(blockedStatus.published, false);
  assert.equal(blockedStatus.latest_publication_decision.outcome, "blocked");
  assert.deepEqual(blockedStatus.latest_publication_decision.reasons, [
    "missing_license",
  ]);
  assert.ok(
    !Object.hasOwn(blockedStatus.latest_publication_decision, "payload"),
  );
  const otherDraftResult = await sdk.callTool({
    name: "create_draft_repository",
    arguments: {
      ...draftArgs,
      idempotency_key: "connection-test-draft-002",
      slug: "connection-test-other",
    },
  });
  assert.ok(!otherDraftResult.isError);
  const otherDraft = JSON.parse(otherDraftResult.content[0].text);
  await sdk.close();
  // Native authorization-code exchange: S256, resource, client and redirect binding.
  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeParams = new URLSearchParams({
    client_id: client,
    resource: `${origin}/mcp/work`,
    scope: "repository:read receipts:read",
    redirect_uri: `${origin}/callback`,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: "opaque-test-state",
  });
  const authResponse = await fetch(
    `${origin}/api/oauth/authorize?${authorizeParams}`,
    {
      redirect: "manual",
    },
  );
  assert.equal(authResponse.status, 303);
  const approvalPath = authResponse.headers.get("location");
  result = await approve(approvalPath, {
    agent_id: agentId,
    scopes: ["repository:read", "receipts:read"],
    max_actions: 10,
  });
  assert.equal(result.response.status, 200);
  const callback = new URL(result.data.redirect_uri);
  assert.equal(callback.searchParams.get("state"), "opaque-test-state");
  const exchangeCode = {
    client_id: client,
    resource: `${origin}/mcp/work`,
    grant_type: "authorization_code",
    code: callback.searchParams.get("code"),
    redirect_uri: `${origin}/callback`,
    code_verifier: verifier,
  };
  for (const bad of [
    { code_verifier: "b".repeat(64) },
    { redirect_uri: `${origin}/other` },
    { resource: `${origin}/mcp/social` },
    { client_id: "00000000-0000-4000-8000-000000000000" },
  ]) {
    result = await json("/api/oauth/token", { ...exchangeCode, ...bad });
    assert.equal(result.response.status, 400);
  }
  result = await json("/api/oauth/token", exchangeCode);
  assert.equal(result.response.status, 200);
  const readToken = result.data.access_token;
  result = await json(
    "/mcp/work",
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_draft_repository", arguments: draftArgs },
    },
    { token: readToken },
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "insufficient_scope");
  result = await json("/api/oauth/token", exchangeCode);
  assert.equal(result.data.error, "invalid_grant");
  // SDK-driven discovery, registration, PKCE, callback and token storage.
  let nativeInformation,
    nativeTokens,
    nativeVerifier,
    nativeAuthorize,
    nativeDiscovery;
  const provider = {
    redirectUrl: `${origin}/native-callback`,
    clientMetadata: {
      client_name: "Native MCP SDK test",
      redirect_uris: [`${origin}/native-callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: "repository:read receipts:read",
    },
    state: () => "native-sdk-state",
    clientInformation: () => nativeInformation,
    saveClientInformation: (value) => {
      nativeInformation = value;
    },
    tokens: () => nativeTokens,
    saveTokens: (value) => {
      nativeTokens = value;
    },
    saveCodeVerifier: (value) => {
      nativeVerifier = value;
    },
    codeVerifier: () => nativeVerifier,
    discoveryState: () => nativeDiscovery,
    saveDiscoveryState: (value) => {
      nativeDiscovery = value;
    },
    redirectToAuthorization: (url) => {
      nativeAuthorize = url;
    },
  };
  const nativeTransport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp/work`),
    {
      authProvider: provider,
    },
  );
  const nativeClient = new Client({
    name: "native-oauth-test",
    version: "1.0.0",
  });
  await assert.rejects(nativeClient.connect(nativeTransport));
  assert.ok(nativeAuthorize);
  const nativeRedirect = await fetch(nativeAuthorize, { redirect: "manual" });
  assert.equal(nativeRedirect.status, 303);
  result = await approve(nativeRedirect.headers.get("location"), {
    agent_id: agentId,
    scopes: ["repository:read", "receipts:read"],
  });
  assert.equal(result.response.status, 200);
  const nativeCallback = new URL(result.data.redirect_uri);
  assert.equal(nativeCallback.searchParams.get("state"), "native-sdk-state");
  await nativeTransport.finishAuth(nativeCallback.searchParams);
  assert.ok(nativeTokens.access_token);
  await nativeClient.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/work`), {
      authProvider: provider,
    }),
  );
  assert.ok(
    (await nativeClient.listTools()).tools.some(
      (t) => t.name === "get_work_status",
    ),
  );
  await nativeClient.close();
  // Isolation: another user cannot select this identity, list its connection or revoke it.
  const wrong = await device(client);
  result = await approve(
    wrong.verification_uri_complete,
    { agent_id: agentId, scopes: ["repository:read"] },
    bob,
  );
  assert.equal(result.response.status, 409);
  const aliceList = (
    await json("/api/agent-connections/list", undefined, { user: alice })
  ).data.connections;
  assert.equal(aliceList.length, 3);
  const bobList = (
    await json("/api/agent-connections/list", undefined, { user: bob })
  ).data.connections;
  assert.equal(bobList.length, 0);
  result = await json(
    "/api/agent-connections/revoke",
    { id: aliceList[0].id },
    { user: bob },
  );
  assert.equal(result.response.status, 404);
  const denied = await device(client);
  await approve(denied.verification_uri_complete, {}, alice, false);
  result = await exchange(client, denied);
  assert.equal(result.data.error, "access_denied");
  // Paid Social eligibility remains enforced by the database.
  const social = await device(
    client,
    "social",
    "social.read social.post social.profile.read",
  );
  const socialOptions = {
    scopes: ["social.read", "social.post", "social.profile.read"],
    display_name: "Social test agent",
    handle: "connection-test-social",
  };
  result = await approve(social.verification_uri_complete, socialOptions);
  assert.equal(result.response.status, 409);
  await queryDatabase(
    `insert into app.subscriptions(clerk_user_id,plan_id,provider,provider_subscription_id,status,current_period_end) values ('${alice}','pro','test','connection-test-paid','active',now()+interval '30 days') returning id`,
    null,
    true,
  );
  result = await approve(social.verification_uri_complete, socialOptions);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  result = await exchange(client, social, "social");
  assert.equal(result.response.status, 200);
  const socialToken = result.data.access_token;
  const socialSdk = new Client({ name: "social-test-sdk", version: "1.0.0" });
  await socialSdk.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/social`), {
      requestInit: { headers: { authorization: `Bearer ${socialToken}` } },
    }),
  );
  const socialStatus = await socialSdk.callTool({
    name: "social_connection_status",
    arguments: {},
  });
  assert.equal(JSON.parse(socialStatus.content[0].text).autonomy, "manual");
  await socialSdk.close();
  result = await json(
    "/mcp/social",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "social_vote", arguments: {} },
    },
    { token: socialToken },
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.data.required_scope, "social.vote");
  // Real CLI device login and generic stdio client, using a private temporary store.
  const cli = spawn(
    process.execPath,
    [
      join(root, "public/agents/connect.mjs"),
      "login",
      "--resource",
      "work",
      "--origin",
      origin,
    ],
    {
      env: { ...process.env, XDG_CONFIG_HOME: temporary },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let cliOutput = "";
  let cliError = "";
  let approved = false;
  const cliDone = new Promise((resolve, reject) => {
    cli.on("error", reject);
    cli.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(cliError)),
    );
  });
  cli.stderr.on("data", (data) => (cliError += data));
  cli.stdout.on("data", (data) => {
    cliOutput += data;
    const link = cliOutput.match(
      /http:\/\/127\.0\.0\.1:[0-9]+\/account\/connect\?code=[A-Z2-9-]+/,
    )?.[0];
    if (link && !approved) {
      approved = true;
      void approve(link, {
        agent_id: agentId,
        scopes: ["repository:read", "receipts:read"],
      }).catch(() => cli.kill());
    }
  });
  await cliDone;
  assert.ok(cliOutput.includes("Connected to Super ii work"));
  assert.ok(!cliOutput.includes("sii_agent_"));
  const hostKey = createHash("sha256")
    .update(origin)
    .digest("hex")
    .slice(0, 16);
  const credentialPath = join(
    temporary,
    "superii",
    "connections",
    hostKey,
    "work.json",
  );
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  const stdio = new Client({ name: "stdio-test-sdk", version: "1.0.0" });
  await stdio.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        join(root, "public/agents/connect.mjs"),
        "serve",
        "--resource",
        "work",
        "--origin",
        origin,
      ],
      env: { ...process.env, XDG_CONFIG_HOME: temporary },
    }),
  );
  assert.ok(
    (await stdio.listTools()).tools.some((t) => t.name === "get_work_status"),
  );
  await stdio.close();
  // Repository bindings apply to both final-state reads and historical receipts.
  const boundRequest = await device(client);
  result = await approve(boundRequest.verification_uri_complete, {
    agent_id: agentId,
    repository_id: repositoryId,
    scopes: ["repository:read", "receipts:read"],
  });
  assert.equal(result.response.status, 200);
  result = await exchange(client, boundRequest);
  assert.equal(result.response.status, 200);
  const boundToken = result.data.access_token;
  for (const [receiptId, expectedError] of [
    [draft.receipt.id, false],
    [otherDraft.receipt.id, true],
  ]) {
    const receipt = await json(
      "/mcp/work",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_action_receipt",
          arguments: { receipt_id: receiptId, repository_id: repositoryId },
        },
      },
      { token: boundToken },
    );
    assert.equal(
      Boolean(receipt.data.result.isError),
      expectedError,
      JSON.stringify(receipt.data),
    );
  }
  const boundHash = createHash("sha256").update(boundToken).digest("hex");
  await queryDatabase(
    `update app.agent_access_tokens set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where token_hash='${boundHash}' returning id`,
    null,
    true,
  );
  result = await json(
    "/api/agent-connections/status?resource=work",
    undefined,
    {
      token: boundToken,
    },
  );
  assert.equal(result.data.status, "expired");
  assert.equal(
    (
      await json(
        "/mcp/work",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { token: boundToken },
      )
    ).response.status,
    401,
  );
  await queryDatabase(
    "update app.social_agents set status='paused' where handle='connection-test-social' returning id",
    null,
    true,
  );
  result = await json(
    "/api/agent-connections/status?resource=social",
    undefined,
    {
      token: socialToken,
    },
  );
  assert.equal(result.data.status, "paused");
  assert.equal(
    (
      await json(
        "/mcp/social",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { token: socialToken },
      )
    ).response.status,
    403,
  );
  await queryDatabase(
    "update app.social_agents set status='active' where handle='connection-test-social' returning id",
    null,
    true,
  );
  // Exhaustion preserves verification reads, but never authorizes another write.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await queryDatabase(
    `update app.agent_access_tokens set actions_used=max_actions where token_hash='${tokenHash}' returning id`,
    null,
    true,
  );
  result = await json(
    "/mcp/work",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_work_status",
        arguments: { repository_id: repositoryId },
      },
    },
    { token },
  );
  assert.equal(result.response.status, 200);
  assert.ok(!result.data.result.isError);
  result = await json(
    "/mcp/work",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_action_receipt",
        arguments: { receipt_id: draft.receipt.id },
      },
    },
    { token },
  );
  assert.equal(result.response.status, 200);
  assert.ok(!result.data.result.isError);
  result = await json(
    "/mcp/work",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_draft_repository", arguments: draftArgs },
    },
    { token },
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.data.error, "action_limit_reached");
  await queryDatabase(
    `update app.organization_members set role='viewer' where organization_id=(select organization_id from app.agent_identities where id='${agentId}') returning profile_id`,
    null,
    true,
  );
  result = await json(
    "/api/agent-connections/status?resource=work",
    undefined,
    { token },
  );
  assert.equal(result.data.status, "operator_changed");
  assert.equal(
    (
      await json(
        "/mcp/work",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { token },
      )
    ).response.status,
    403,
  );
  await queryDatabase(
    `update app.organization_members set role='owner' where organization_id=(select organization_id from app.agent_identities where id='${agentId}') returning profile_id`,
    null,
    true,
  );
  await queryDatabase(
    `update app.subscriptions set status='cancelled' where provider_subscription_id='connection-test-paid' returning id`,
    null,
    true,
  );
  result = await json(
    "/api/agent-connections/status?resource=social",
    undefined,
    {
      token: socialToken,
    },
  );
  assert.equal(result.data.status, "sponsorship_required");
  assert.equal(
    (
      await json(
        "/mcp/social",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { token: socialToken },
      )
    ).response.status,
    403,
  );
  const expiring = await device(client);
  await queryDatabase(
    `update app_private.agent_connection_requests set expires_at=now()-interval '1 second' where user_code_hash=encode(public.digest('${expiring.user_code.replace("-", "")}','sha256'),'hex') returning id`,
    null,
    true,
  );
  result = await exchange(client, expiring);
  assert.equal(result.data.error, "expired_token");
  assert.equal(
    (await requestView(expiring.verification_uri_complete)).response.status,
    404,
  );
  result = await json(
    "/api/agent-connections/revoke",
    { id: aliceList.at(-1).id },
    { user: alice },
  );
  assert.equal(result.response.status, 200);
  const revoked = await json(
    "/api/agent-connections/status?resource=work",
    undefined,
    { token },
  );
  assert.equal(revoked.data.status, "revoked");
  assert.equal(
    (
      await json(
        "/mcp/work",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { token },
      )
    ).response.status,
    401,
  );
  console.log(
    `Agent connection flows passed: ${calls} HTTP checks, signed restricted database contexts, device login, PKCE exchange, grants, replay, cross-user isolation, paid Social, real MCP HTTP and stdio clients, idempotent draft, verified status and revocation.`,
  );
  if (process.env.SUPERII_CONNECTION_PREVIEW === "1") {
    const source = await readFile(
      join(root, "src/pages/account/connect.astro"),
      "utf8",
    );
    const page = source
      .replace(
        "const auth = typeof Astro.locals.auth === 'function' ? Astro.locals.auth() : null;",
        "if (!import.meta.env.DEV) return new Response('Not found', {status:404});\nconst auth = {userId:'local-isolated-fixture'};",
      )
      .replace(
        "import BaseLayout",
        "import AgentConnections from '@/components/AgentConnections.astro';\nimport BaseLayout",
      )
      .replace(
        "</BaseLayout>",
        '<section class="shell"><p>Local test fixture · disposable data only</p><AgentConnections /></section></BaseLayout>',
      );
    await writeFile(previewPage, page, { flag: "wx" });
    preview = true;
    await queryDatabase(
      `update app.subscriptions set status='active' where provider_subscription_id='connection-test-paid' returning id`,
      null,
      true,
    );
    const visualWork = await device(
      client,
      "work",
      "repository:read repository:create receipts:read",
    );
    const visualSocial = await device(
      client,
      "social",
      "social.read social.post social.reply social.notifications.read",
    );
    console.log(
      "Local approval UI: " +
        visualWork.verification_uri_complete +
        "\nLocal Social UI: " +
        visualSocial.verification_uri_complete,
    );
    await new Promise((resolve) => process.once("SIGINT", resolve));
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(bundle, { force: true });
  await rm(temporary, { recursive: true, force: true });
  if (preview) await rm(previewPage, { force: true });
}
