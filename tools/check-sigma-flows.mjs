import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { resolve, join } from "node:path";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { queryDatabase as db } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, ".."),
  bundle = join(root, "node_modules", `.sigma-flow-${process.pid}.mjs`);
const definitions = {
  stories: "src/pages/api/sigma/stories.ts",
  likes: "src/pages/api/sigma/likes.ts",
  editors: "src/pages/api/sigma/editors.ts",
  subscribe: "src/pages/api/sigma/subscribe.ts",
  subscription: "src/pages/api/sigma/subscription.ts",
  editions: "src/pages/api/sigma/editions.ts",
  email: "src/lib/sigma-email.ts",
  input: "src/lib/sigma-input.ts",
  markdown: "src/lib/repository-markdown.ts",
};
await build({
  stdin: {
    resolveDir: root,
    contents: Object.entries(definitions)
      .map(
        ([name, file]) =>
          `export * as ${name} from ${JSON.stringify(resolve(root, file))};`,
      )
      .join("\n"),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
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
const r = await import(pathToFileURL(bundle).href);
const run = randomUUID().slice(0, 8);
const names = ["author", "editor", "other", "admin"].map(
  (name) => `sigma-${name}-${run}`,
);
const actors = {};
const emails = [];
const fetchOriginal = globalThis.fetch;
const env = {
  RESEND_API_KEY: "test-only-not-a-real-key",
  SIGMA_EMAIL_FROM: "Sigma Test <sigma@example.test>",
  SIGMA_TOKEN_SECRET: "isolated-sigma-token-secret-at-least-32-characters",
  SIGMA_PUBLIC_ORIGIN: "https://sigma.example.test",
};
const origin = "https://sigma.example.test";
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const owner = (sql) => db(sql, null, true);
function locals(name, configured = true) {
  return {
    __testActor: actors[name] ?? { actorKind: "public" },
    __testEnv: configured ? env : {},
    auth: () => ({ userId: name ?? null }),
    currentUser: async () =>
      name
        ? {
            id: name,
            username: name,
            firstName: "Sigma",
            lastName: "Test",
            emailAddresses: [],
            primaryEmailAddressId: null,
            imageUrl: null,
          }
        : null,
  };
}
async function post(route, name, body, options = {}) {
  const url = new URL(options.path ?? `/api/sigma/${route}`, origin);
  const request = new Request(url, {
    method: "POST",
    headers: {
      origin: options.origin ?? origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return r[route].POST({
    request,
    url,
    locals: locals(name, options.configured !== false),
    params: {},
  });
}
async function ok(response) {
  assert(response.ok, `${response.status}: ${await response.clone().text()}`);
  return response.json();
}
let providerMode = "ok";
globalThis.fetch = async (url, init) => {
  assert.equal(
    url,
    "https://api.resend.com/emails",
    "Tests never contact an external provider",
  );
  const mail = JSON.parse(init.body);
  emails.push({ mail, key: init.headers["Idempotency-Key"] });
  if (providerMode === "timeout")
    throw new Error("simulated ambiguous timeout");
  return Response.json({ id: `mock-${emails.length}` });
};
try {
  for (const name of names) {
    const rows = await db(
      `select app.ensure_profile('${name}','${name}','Sigma fixture',null) as id`,
      { actorKind: "clerk", clerkUserId: name },
    );
    actors[name] = {
      actorKind: "clerk",
      clerkUserId: name,
      profileId: rows[0].id,
      isAdmin: name === names[3],
    };
  }
  const [author, editor, other, admin] = names;
  const id = randomUUID();
  const document = {
    source_language: "en",
    category: "models",
    translations: {
      en: {
        title: "A useful model release",
        summary: "Original summary.",
        body: "A measured result with a source.",
      },
      ru: {
        title: "Полезная модель",
        summary: "Краткое описание.",
        body: "Проверенный результат и источник.",
      },
    },
    sources: [{ label: "Primary source", url: "https://example.test/source" }],
    images: [],
    rights_confirmed: true,
  };
  const save = (name, version, action, doc = document) =>
    post("stories", name, {
      id,
      version,
      slug: `model-${run}`,
      action,
      document: doc,
    });
  assert.equal((await save(null, 0, "save")).status, 401);
  assert.equal(
    (await post("stories", author, {}, { origin: "https://other.test" }))
      .status,
    403,
  );
  await ok(await save(author, 0, "save"));
  assert.equal((await post("likes", other, { id, active: true })).status, 404, "drafts cannot receive public likes");
  assert.equal(
    (await db(`select * from app.sigma_public_stories()`)).length,
    0,
  );
  assert.equal(
    (await db(`select * from app.sigma_drafts('${id}')`, actors[other])).length,
    0,
  );
  await assert.rejects(() => db("select * from app.sigma_stories"));
  await assert.rejects(() => db("select * from app.sigma_subscribers"));
  assert.equal((await save(other, 1, "save")).status, 400);
  assert.equal((await save(author, 1, "publish")).status, 400);
  assert.equal(
    (await post("editors", other, { handle: editor, enabled: true })).status,
    403,
  );
  await ok(await post("editors", admin, { handle: editor, enabled: true }));
  await ok(await save(author, 1, "submit"));
  await ok(await save(editor, 2, "publish"));
  assert.equal((await post("likes", null, { id, active: true })).status, 401);
  assert.equal((await post("likes", other, { id, active: true }, { origin: "https://other.test" })).status, 403);
  assert.equal((await post("likes", other, { id, active: true, profile_id: actors[author].profileId })).status, 400);
  await assert.rejects(() => db("select * from app.sigma_story_likes"));
  await assert.rejects(() => db(`select app.sigma_story_engagement('${id}',true)`));
  assert.deepEqual(await ok(await post("likes", other, { id, active: true })), { liked: true, likes_count: 1 });
  assert.deepEqual(await ok(await post("likes", other, { id, active: true })), { liked: true, likes_count: 1 }, "retries do not add duplicate hearts");
  assert.deepEqual((await db(`select app.sigma_story_engagement('${id}') as result`))[0].result, { liked: false, likes_count: 1 }, "anonymous readers see a count, never another member's state");
  assert.deepEqual((await db(`select app.sigma_story_engagement('${id}') as result`, actors[other]))[0].result, { liked: true, likes_count: 1 });
  assert.deepEqual(await ok(await post("likes", other, { id, active: false })), { liked: false, likes_count: 0 });
  for (let i = 0; i < 4; i++) {
    const extraId = randomUUID();
    const extra = structuredClone(document);
    extra.translations.en.title = `Page story ${i} ${run}`;
    extra.category = i % 2 ? "research" : "models";
    await ok(await post("stories", author, { id: extraId, version: 0, slug: `page-${i}-${run}`, action: "save", document: extra }));
    await ok(await post("stories", editor, { id: extraId, version: 1, slug: `page-${i}-${run}`, action: "publish", document: extra }));
  }
  const browse = async (query = "", topic = "", page = 0) => (await db(`select app.sigma_public_page(${quote(query)},${quote(topic)},${page},3) as result`))[0].result;
  const firstPage = await browse(), lastPage = await browse("", "", 999);
  assert.equal(firstPage.total, 5);
  assert.equal(firstPage.stories.length, 3);
  assert.equal(lastPage.page, 1, "out-of-range requests clamp to the final real page");
  assert.equal(lastPage.stories.length, 2);
  assert.equal(new Set([...firstPage.stories, ...lastPage.stories].map((story) => story.id)).size, 5);
  assert.equal((await browse("Полезная", "models")).total, 3, "search covers translations and combines with topic filtering");
  assert.equal((await browse("", "research")).total, 2);
  assert.equal((await browse("no-matching-news-" + run)).total, 0);
  assert.equal(
    (
      await db(
        `select * from app.sigma_public_story('${author}','model-${run}')`,
      )
    )[0].document.translations.en.title,
    document.translations.en.title,
  );
  const changed = structuredClone(document);
  changed.translations.en.title = "An unpublished change";
  await ok(await save(author, 3, "save", changed));
  assert.equal((await browse("An unpublished change")).total, 0, "search does not expose private draft edits");
  assert.equal(
    (await save(author, 3, "save", changed)).status,
    409,
    "stale editors must not overwrite a later save",
  );
  assert.equal(
    (
      await db(
        `select * from app.sigma_public_story('${author}','model-${run}')`,
      )
    )[0].document.translations.en.title,
    document.translations.en.title,
    "draft edits do not alter the public snapshot",
  );
  const foreign = structuredClone(changed);
  foreign.images = [
    {
      url: `/api/sigma/media/${randomUUID()}/${"a".repeat(64)}.jpg`,
      alt: "Photo",
      credit: "Author",
      source_url: "https://example.test/photo",
    },
  ];
  assert.equal((await save(author, 4, "save", foreign)).status, 400);
  await ok(await post("editors", admin, { handle: editor, enabled: false }));
  assert.equal(
    (await save(editor, 4, "publish")).status,
    400,
    "revoked editor cannot publish",
  );
  assert.equal(
    (
      await db(
        `select app.sigma_media_access('${id}','/not-published',false) as allowed`,
      )
    )[0].allowed,
    false,
  );
  assert.equal(
    (
      await db(
        `select app.sigma_media_access('${id}','',true) as allowed`,
        actors[author],
      )
    )[0].allowed,
    true,
  );
  await owner(
    `update app.profiles set is_public=false where id='${actors[author].profileId}' returning id`,
  );
  assert.equal((await browse()).total, 0, "filtered totals do not reveal hidden authors");
  assert.equal((await db(`select app.sigma_story_engagement('${id}') as result`))[0].result, null);
  assert.equal((await post("likes", other, { id, active: true })).status, 404);
  assert.equal(
    (await db(`select * from app.sigma_public_stories()`)).length,
    0,
    "hidden profiles do not leak their stories",
  );
  await owner(
    `update app.profiles set is_public=true where id='${actors[author].profileId}' returning id`,
  );
  const selection = r.input.sigmaTranslation(document, "zh-CN");
  assert(selection.fallback);
  assert.equal(selection.language, "en");
  assert(
    !r.markdown
      .renderRepositoryMarkdown("<script>alert(1)</script>")
      .includes("<script>"),
  );
  assert(
    !r.input.sigmaDocumentSchema.safeParse({
      ...document,
      sources: [{ label: "Bad", url: "javascript:alert(1)" }],
    }).success,
  );
  const inbox = `reader-${run}@example.test`;
  assert.equal(
    (
      await post(
        "subscribe",
        null,
        { email: inbox, locale: "ru", consent: true },
        { configured: false },
      )
    ).status,
    503,
  );
  await ok(
    await post("subscribe", null, {
      email: inbox,
      locale: "ru",
      consent: true,
    }),
  );
  assert.equal(emails.length, 1);
  assert(emails[0].mail.subject.includes("Подтвердите"));
  const confirmToken = emails[0].mail.text.match(/token=([^&\s]+)/)[1];
  const token = r.email.verifySigmaToken;
  assert(await token(env.SIGMA_TOKEN_SECRET, "confirm", confirmToken));
  assert.equal(
    await token(env.SIGMA_TOKEN_SECRET, "manage", confirmToken),
    null,
  );
  assert.equal(
    await token(
      env.SIGMA_TOKEN_SECRET,
      "confirm",
      confirmToken.slice(0, -1) + "z",
    ),
    null,
  );
  await ok(
    await post("subscribe", null, {
      email: inbox,
      locale: "en",
      consent: true,
    }),
  );
  assert.equal(
    emails.length,
    1,
    "repeat request within cooldown does not mail again",
  );
  assert.equal(
    (
      await owner(
        `select status from app.sigma_subscribers where email=${quote(inbox)}`,
      )
    )[0].status,
    "pending",
    "opening a GET link never changes subscription",
  );
  await ok(
    await post("subscription", null, {
      token: confirmToken,
      action: "confirm",
    }),
  );
  let subscriber = (
    await owner(
      `select * from app.sigma_subscribers where email=${quote(inbox)}`,
    )
  )[0];
  assert.equal(subscriber.status, "active");
  assert.equal(subscriber.locale, "ru");
  const manage = await r.email.sigmaToken(
    env.SIGMA_TOKEN_SECRET,
    "manage",
    subscriber.id,
    subscriber.token_version,
  );
  const scannerResponse = await r.subscription.GET({
    url: new URL(
      `/api/sigma/subscription?${new URLSearchParams({ token: manage })}`,
      origin,
    ),
  });
  assert.equal(scannerResponse.status, 303);
  assert.equal(
    new URL(scannerResponse.headers.get("location"), origin).pathname,
    "/sigma/subscription",
  );
  assert.equal(
    (
      await owner(
        `select status from app.sigma_subscribers where email=${quote(inbox)}`,
      )
    )[0].status,
    "active",
    "A mail scanner GET cannot unsubscribe a reader",
  );
  await ok(
    await post("subscription", null, {
      token: manage,
      action: "language",
      locale: "zh-CN",
    }),
  );
  const edition = randomUUID();
  const prepared = await ok(
    await post("editions", admin, {
      action: "prepare",
      id: edition,
      stories: [id],
    }),
  );
  assert.equal(prepared.subscribers, 1);
  assert.equal(
    (
      await post("editions", author, {
        action: "send",
        id: edition,
        confirmation: edition,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("editions", admin, {
        action: "send",
        id: edition,
        confirmation: randomUUID(),
      })
    ).status,
    403,
  );
  const result = await ok(
    await post("editions", admin, {
      action: "send",
      id: edition,
      confirmation: edition,
    }),
  );
  assert.equal(result.edition.sent, 1);
  assert.equal(emails.length, 2);
  assert(emails[1].mail.html.includes("暂时没有此语言"));
  assert(!emails[1].mail.html.includes("An unpublished change"));
  assert.equal(emails[1].mail.to.length, 1);
  assert(emails[1].mail.headers["List-Unsubscribe-Post"]);
  await ok(
    await post("editions", admin, {
      action: "send",
      id: edition,
      confirmation: edition,
    }),
  );
  assert.equal(emails.length, 2, "duplicate send must not send again");
  const ambiguous = randomUUID();
  await ok(
    await post("editions", admin, {
      action: "prepare",
      id: ambiguous,
      stories: [id],
    }),
  );
  providerMode = "timeout";
  await ok(
    await post("editions", admin, {
      action: "send",
      id: ambiguous,
      confirmation: ambiguous,
    }),
  );
  const firstKey = emails.at(-1).key;
  await owner(
    `update app.sigma_deliveries set claimed_at=now()-interval '3 minutes' where edition_id='${ambiguous}' returning id`,
  );
  providerMode = "ok";
  await ok(
    await post("editions", admin, {
      action: "send",
      id: ambiguous,
      confirmation: ambiguous,
    }),
  );
  assert.equal(
    emails.at(-1).key,
    firstKey,
    "ambiguous retry retains its idempotency key",
  );
  const unsubscribeURL = new URL(
    emails.at(-1).mail.headers["List-Unsubscribe"].slice(1, -1),
  );
  const response = await r.subscription.POST({
    locals: locals(null),
    url: unsubscribeURL,
    request: new Request(unsubscribeURL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }),
  });
  assert.equal(response.status, 200);
  subscriber = (
    await owner(
      `select * from app.sigma_subscribers where email=${quote(inbox)}`,
    )
  )[0];
  assert.equal(subscriber.status, "unsubscribed");
  const finalEdition = randomUUID();
  await ok(
    await post("editions", admin, {
      action: "prepare",
      id: finalEdition,
      stories: [id],
    }),
  );
  const count = emails.length;
  await ok(
    await post("editions", admin, {
      action: "send",
      id: finalEdition,
      confirmation: finalEdition,
    }),
  );
  assert.equal(
    emails.length,
    count,
    "unsubscribed readers never enter a new delivery queue",
  );
  const expired = (
    await db(
      `select app.sigma_request_subscription('expired-${run}@example.test','en') as s`,
    )
  )[0].s;
  await owner(
    `update app.sigma_subscribers set requested_at=now()-interval '25 hours' where id='${expired.id}' returning id`,
  );
  const expiredToken = await r.email.sigmaToken(
    env.SIGMA_TOKEN_SECRET,
    "confirm",
    expired.id,
    expired.nonce,
  );
  assert.equal(
    (
      await post("subscription", null, {
        token: expiredToken,
        action: "confirm",
      })
    ).status,
    400,
  );
  console.log(
    "Sigma passed: authenticated author/editor routes; private snapshots; stale edits; editor revocation; hidden owners; source and image ownership; locale fallback; double opt-in; token purpose/expiry; no email enumeration on repeats; frozen editions; admin-only delivery; retry dedupe; unsubscribe and recipient exclusion. All email delivery mocked.",
  );
} finally {
  globalThis.fetch = fetchOriginal;
  await rm(bundle, { force: true });
}
