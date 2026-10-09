import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { queryDatabase as db } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, "..");
const bundle = join(root, "node_modules", `.product-flow-${process.pid}.mjs`);
const definitions = {
  qr: "src/pages/products/[owner]/[slug]/qr.svg.ts",
  markdown: "src/pages/products/[owner]/[slug]/product.md.ts",
  source: "src/pages/api/products/source.ts",
  media: "src/pages/api/products/media.ts",
  upload: "src/pages/api/showcase/media/index.ts",
  cards: "src/pages/api/products/cards.ts",
  website: "src/pages/api/products/website.ts",
  create: "src/pages/api/products/index.ts",
  draft: "src/pages/api/products/[productId].ts",
  public: "src/pages/api/products/[owner]/[slug].ts",
  answer: "src/pages/api/products/[owner]/[slug]/answer.ts",
  workspace: "src/pages/api/products/workspace.ts",
  products: "src/lib/products.ts",
  store: "src/lib/product-store.ts",
  mcp: "src/lib/mcp-server.ts",
  a2a: "src/lib/a2a.ts",
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
      name: "isolated-product-fixtures",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
        b.onResolve({ filter: /^agents\/mcp\/server$/ }, () => ({
          path: "mcp-transport",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: args.path.startsWith("@/")
            ? resolve(root, "src", args.path.slice(2, -4))
            : resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "cloudflare",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          resolveDir: root,
          contents:
            args.path === "cloudflare"
              ? `const objects=new Map();export const env={SHOWCASE_MEDIA:{async put(key,bytes){objects.set(key,bytes);},async get(key){const bytes=objects.get(key);return bytes?{body:new Response(bytes).body}:null;},async delete(key){objects.delete(key);}}};export function waitUntil(){}`
              : `import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';export function createMcpHandler(createServer){return {async fetch(request){const server=createServer();const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);}}}`,
        }));
      },
    },
  ],
});
const r = await import(pathToFileURL(bundle).href);
const alice = "product_flow_alice",
  bob = "product_flow_bob";
const organizations = [];
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
          firstName: "Product",
          lastName: "Test",
          emailAddresses: [],
          primaryEmailAddressId: null,
          imageUrl: null,
        }
      : null,
});
const request = (
  method,
  body,
  path = "/api/products",
  headers = method === "GET"
    ? { "sec-fetch-site": "same-origin" }
    : { origin: "http://localhost", "content-type": "application/json" },
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
const context = (user, method, body, params = {}, headers) => {
  const req = request(method, body, "/api/products", headers);
  return { locals: locals(user), request: req, url: new URL(req.url), params };
};
const json = async (response) => {
  assert(response.ok, `${response.status}: ${await response.clone().text()}`);
  return response.json();
};
const quote = (value) =>
  "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
let draft;
let other;
try {
  const company = r.products.companyDocumentSchema.parse({
    name: "Local fixture company",
    website: "https://example.com/",
    email: "public@example.com",
  });
  const product = r.products.productDocumentSchema.parse({
    name: "Local fixture robot",
    summary: "A robot used only in local test fixtures.",
    specs: [
      {
        label: "Interface",
        value: "USB-C",
        source_url: "https://example.com/specs",
      },
    ],
    resources: [{ label: "SDK", kind: "sdk", url: "https://example.com/sdk" }],
  });
  const creation = {
    creation_key: randomUUID(),
    organization_id: null,
    handle: "product-fixture-company",
    slug: "fixture-robot",
    company,
    product,
    company_version: 0,
  };
  assert.equal(
    (await r.create.POST(context(null, "POST", creation))).status,
    401,
  );
  assert.equal(
    (
      await r.create.POST(
        context(
          alice,
          "POST",
          creation,
          {},
          {
            "content-type": "application/json",
            origin: "https://attacker.invalid",
          },
        ),
      )
    ).status,
    403,
  );
  draft = await json(await r.create.POST(context(alice, "POST", creation)));
  organizations.push(draft.organization_id);
  assert.equal(
    (await json(await r.create.POST(context(alice, "POST", creation)))).id,
    draft.id,
    "creation retry duplicated the company",
  );
  const bobCreation = {
    ...creation,
    creation_key: randomUUID(),
    handle: "other-fixture-company",
  };
  other = await json(await r.create.POST(context(bob, "POST", bobCreation)));
  organizations.push(other.organization_id);
  const params = { productId: draft.id };
  const publicParams = { owner: draft.owner, slug: draft.slug };
  const read = () => r.public.GET(context(null, "GET", null, publicParams));
  assert.equal((await read()).status, 404, "private draft leaked");
  assert.equal(
    (await r.draft.GET(context(bob, "GET", null, params))).status,
    404,
  );
  assert.equal(
    (
      await r.draft.GET(
        context(alice, "GET", null, params, { "sec-fetch-site": "cross-site" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await r.draft.GET(context(alice, "GET", null, params))).status,
    200,
  );
  const mutate = (user, body) =>
    r.draft.POST(context(user, "POST", body, params));
  const saveBody = (overrides = {}) => ({
    action: "save",
    version: draft.version,
    company_version: draft.company_version,
    company: draft.company,
    product: draft.product,
    ...overrides,
  });
  assert.equal((await mutate(bob, saveBody())).status, 403);
  const before = saveBody();
  draft = await json(await mutate(alice, before));
  assert.equal((await mutate(alice, before)).status, 409);
  assert.equal(
    (
      await db(
        `select is_public from app.organizations where id='${draft.organization_id}'`,
        null,
        true,
      )
    )[0].is_public,
    false,
  );
  const profile = (
    await db(
      `select id from app.profiles where clerk_user_id='${alice}'`,
      null,
      true,
    )
  )[0].id;
  const bobProfile = (
    await db(
      `select id from app.profiles where clerk_user_id='${bob}'`,
      null,
      true,
    )
  )[0].id;
  const actor = { actorKind: "clerk", clerkUserId: alice, profileId: profile };
  await assert.rejects(
    db("select * from app.company_products", actor),
    "raw draft tables must not be readable through web role",
  );
  await assert.rejects(
    db(
      `select app.start_company_product('${randomUUID()}','${other.organization_id}','other-fixture-company',${quote(company)},'unauthorized',${quote(product)},0)`,
      actor,
    ),
  );
  // The existing Showcase gateway retains its three-successful-uploads lifetime limit.
  const media = [];
  for (let n = 0; n < 3; n++) {
    const key = `showcase/organization/${draft.organization_id}/${randomUUID()}.jpg`;
    const rows = await db(
      `select * from app.create_showcase_media('${draft.organization_id}',null,'${key}','${"a".repeat(64)}',1024,800,500,'','','Fixture image',null)`,
      actor,
    );
    media.push(rows[0].media_id);
  }
  await assert.rejects(
    db(
      `select * from app.create_showcase_media('${draft.organization_id}',null,'showcase/organization/${draft.organization_id}/${randomUUID()}.jpg','${"b".repeat(64)}',1024,800,500,'','','Fourth fixture image',null)`,
      actor,
    ),
  );
  const otherMedia = (
    await db(
      `select * from app.create_showcase_media('${other.organization_id}',null,'showcase/organization/${other.organization_id}/${randomUUID()}.jpg','${"c".repeat(64)}',1024,800,500,'','','Other image',null)`,
      { actorKind: "clerk", clerkUserId: bob, profileId: bobProfile },
    )
  )[0].media_id;
  assert.equal(
    (
      await mutate(
        alice,
        saveBody({ product: { ...draft.product, image_ids: [otherMedia] } }),
      )
    ).status,
    403,
  );
  draft = await json(
    await mutate(
      alice,
      saveBody({ product: { ...draft.product, image_ids: media } }),
    ),
  );
  const token = "a".repeat(43),
    hash = createHash("sha256").update(token).digest("hex");
  const card = (
    await db(
      `insert into app.cards(owner_profile_id,name,status,share_token_hash,share_token_ciphertext,share_token_iv) values ('${profile}','Fixture representative','active','${hash}',repeat('x',24),repeat('a',16)) returning id`,
      null,
      true,
    )
  )[0].id;
  await db(
    `insert into app.card_public_snapshots(card_id,owner_profile_id,snapshot) values ('${card}','${profile}','{}') returning card_id`,
    null,
    true,
  );
  draft = await json(
    await mutate(
      alice,
      saveBody({
        company: {
          ...draft.company,
          representative_card_url: `https://superii.site/c/${token}`,
        },
      }),
    ),
  );
  const publish = () =>
    mutate(alice, {
      action: "publish",
      version: draft.version,
      company_version: draft.company_version,
      authorized: true,
    });
  assert.equal(
    (
      await mutate(alice, {
        action: "publish",
        version: draft.version,
        company_version: draft.company_version,
        authorized: false,
      })
    ).status,
    422,
  );
  draft = await json(await publish());
  const published = await json(await read());
  assert.equal(published.product.name, product.name);
  assert.equal(published.images.length, 3);
  assert.equal(
    published.company.representative_card_url,
    `https://superii.site/c/${token}`,
  );
  assert.equal(
    (await json(await r.create.GET(context(null, "GET", null)))).items.some(
      (item) => item.id === draft.id,
    ),
    true,
  );
  draft = await json(
    await mutate(
      alice,
      saveBody({ product: { ...draft.product, name: "Private changed name" } }),
    ),
  );
  assert.equal((await json(await read())).product.name, product.name);
  // Shared company revision conflicts are rejected even when creating another product.
  assert.equal(
    (
      await r.create.POST(
        context(alice, "POST", {
          ...creation,
          creation_key: randomUUID(),
          organization_id: draft.organization_id,
          slug: "second-product",
          company_version: 0,
        }),
      )
    ).status,
    409,
  );
  const second = await json(
    await r.create.POST(
      context(alice, "POST", {
        ...creation,
        creation_key: randomUUID(),
        organization_id: draft.organization_id,
        slug: "second-product",
        company_version: draft.company_version,
        company: { ...draft.company, name: "New private company draft" },
      }),
    ),
  );
  assert.equal(second.company.name, "New private company draft");
  assert.equal((await json(await read())).company.name, company.name);
  draft = await json(await r.draft.GET(context(alice, "GET", null, params)));
  const verification = (
    await db(
      `select app.start_company_website_check('${draft.organization_id}','example.com') as value`,
      actor,
    )
  )[0].value;
  assert.equal(
    (
      await db(
        `select app.complete_company_website_check('${draft.organization_id}','wrong.example.com','${verification.challenge}') as ok`,
        actor,
      )
    )[0].ok,
    false,
  );
  assert.equal(
    (
      await db(
        `select app.complete_company_website_check('${draft.organization_id}','example.com','${verification.challenge}') as ok`,
        actor,
      )
    )[0].ok,
    true,
  );
  assert.equal(
    (await json(await read())).evidence.website_control.hostname,
    "example.com",
  );
  draft = await json(
    await mutate(
      alice,
      saveBody({
        company: { ...draft.company, website: "https://another.example.com/" },
      }),
    ),
  );
  draft = await json(await publish());
  assert.equal((await json(await read())).evidence.website_control, null);
  await db(
    `update app.cards set status='paused' where id='${card}' returning id`,
    null,
    true,
  );
  assert.equal((await json(await read())).company.representative_card_url, "");
  const mcp = r.mcp.createSuperiiMcpHandler(locals(null), "http://localhost");
  const call = async (name, args) => {
    const response = await mcp.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    return json(response);
  };
  const result = await call("get_product", publicParams);
  assert.equal(
    JSON.parse(result.result.content[0].text).product.name,
    "Private changed name",
  );
  const unknown = await call("ask_product", {
    ...publicParams,
    question: "What is the battery life?",
  });
  assert.equal(
    JSON.parse(unknown.result.content[0].text).state,
    "not_documented",
  );
  const a2a = await r.a2a.executeA2APublicSkill(
    locals(null),
    "https://superii.site",
    [{ data: { skillId: "read-company-product", arguments: publicParams } }],
  );
  assert.equal(a2a.ok, true);
  assert.equal(a2a.output.product.name, "Private changed name");
  draft = await json(
    await mutate(alice, { action: "pause", version: draft.version }),
  );
  assert.equal((await read()).status, 404);
  assert.equal((await call("get_product", publicParams)).result.isError, true);
  await db(
    `delete from app.organization_members where organization_id='${draft.organization_id}' and profile_id='${profile}' returning organization_id`,
    null,
    true,
  );
  assert.equal(
    (await r.create.POST(context(alice, "POST", creation))).status,
    403,
    "idempotent creation retry ignored revoked membership",
  );
  if (process.env.SUPERII_PRODUCT_PREVIEW === "1") {
    const { productPreview } = await import("./lib/product-preview.mjs");
    await productPreview(root, r, locals);
  }
  console.log(
    "OK: company product creation/retry, private drafts, publication/pause, stale company and product edits, exact website binding, Card revocation, cross-company media, lifetime quota, real MCP and A2A published reads",
  );
} finally {
  for (const org of organizations)
    await db(
      `delete from app.organizations where id='${org}' returning id`,
      null,
      true,
    );
  await db(
    `delete from app.profiles where clerk_user_id in ('${alice}','${bob}') returning id`,
    null,
    true,
  );
  await rm(bundle, { force: true });
}
