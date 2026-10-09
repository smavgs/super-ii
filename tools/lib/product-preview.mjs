// Explicit opt-in local QA server. No production credentials or persisted demo rows.
import { createServer } from "node:http";
import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { queryDatabase } from "./connection-test-db.mjs";
export async function productPreview(root, r, locals) {
  const user = "product_flow_ui";
  const origin = "http://127.0.0.1:13425";
  const pages = [];
  let server;
  async function context(request, params = {}) {
    return { locals: locals(user), request, url: new URL(request.url), params };
  }
  async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname;
    let route,
      params = {};
    if (path === "/__preview-data") {
      const ctx = await context(
        new Request(origin + "/api/products/workspace", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
      );
      const response = await r.workspace.GET(ctx);
      if (!response.ok) return response;
      const workspace = await response.json();
      const id = url.searchParams.get("id");
      let draft = id ? await r.store.productDraft(ctx.locals, id) : null;
      const item = url.searchParams.has("owner")
        ? await r.store.publicProduct(
            ctx.locals,
            url.searchParams.get("owner"),
            url.searchParams.get("slug"),
          )
        : null;
      return Response.json({ workspace, draft, item });
    }
    if (path === "/api/products") route = r.create[request.method];
    else if (path === "/api/products/workspace") route = r.workspace.GET;
    else if (path === "/api/products/media") route = r.media.GET;
    else if (path === "/api/products/source") route = r.source.POST;
    else if (path === "/api/products/cards") route = r.cards.GET;
    else if (path === "/api/products/website") route = r.website.POST;
    else if (path === "/api/showcase/media") route = r.upload.POST;
    else if (/^\/api\/products\/[\da-f-]{36}$/.test(path)) {
      params = { productId: path.split("/").at(-1) };
      route = r.draft[request.method];
    } else if (/^\/api\/products\/[^/]+\/[^/]+\/answer$/.test(path)) {
      const parts = path.split("/");
      params = { owner: parts[3], slug: parts[4] };
      route = r.answer.GET;
    } else if (/^\/api\/products\/[^/]+\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      params = { owner: parts[3], slug: parts[4] };
      route = r.public.GET;
    } else if (
      /^\/products\/[^/]+\/[^/]+\/(qr.svg|product.json|product.md)$/.test(path)
    ) {
      const parts = path.split("/");
      params = { owner: parts[2], slug: parts[3] };
      route =
        parts[4] === "qr.svg"
          ? r.qr.GET
          : parts[4] === "product.md"
            ? r.markdown.GET
            : r.public.GET;
    } else if (/^\/showcase-images\/[\da-f-]+.jpg$/.test(path)) {
      const id = path.split("/").at(-1).replace(".jpg", "");
      const rows = await queryDatabase(
        `select owner_organization_id from app.showcase_media where id='${id}'`,
        null,
        true,
      );
      if (!rows[0]) return new Response(null, { status: 404 });
      const req = new Request(
        `${origin}/api/products/media?organization_id=${rows[0].owner_organization_id}&id=${id}`,
        { headers: { "sec-fetch-site": "same-origin" } },
      );
      return r.media.GET(await context(req));
    }
    if (route) return route(await context(request, params));
    const target = new URL(request.url);
    target.host = "127.0.0.1:13426";
    const locale = path.startsWith("/zh-cn/")
      ? "/zh-cn"
      : path.startsWith("/ru/")
        ? "/ru"
        : "";
    const localPath = path.slice(locale.length);
    if (
      localPath === "/workspace/products/new" ||
      /^\/workspace\/products\/[\da-f-]{36}$/.test(localPath)
    ) {
      target.pathname = locale + "/workspace/qa-products-editor";
      if (!localPath.endsWith("/new"))
        target.searchParams.set("id", localPath.split("/").at(-1));
    } else if (/^\/products\/[^/]+\/[^/]+(?:\/sheet)?$/.test(localPath)) {
      const parts = localPath.split("/");
      target.pathname =
        locale +
        (parts[4] === "sheet"
          ? "/workspace/qa-products-sheet"
          : "/workspace/qa-products-public");
      target.searchParams.set("owner", parts[2]);
      target.searchParams.set("slug", parts[3]);
    }
    const upstream = await fetch(target, { redirect: "manual" });
    const headers = new Headers(upstream.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  try {
    const editor = `---\nimport BaseLayout from '@/layouts/BaseLayout.astro';import ProductEditor from '@/components/ProductEditor.astro';if(!import.meta.env.DEV)return new Response(null,{status:404});const data=await(await fetch('${origin}/__preview-data?id='+encodeURIComponent(Astro.url.searchParams.get('id')??''))).json();\n---\n<BaseLayout title="Local product test" noindex><p style="background:#fff1aa;padding:1rem">LOCAL TEST ONLY · disposable database</p><ProductEditor draft={data.draft} workspace={data.workspace} signedIn /></BaseLayout>`;
    for (const [name, content] of [
      ["qa-products-editor.astro", editor],
      ...(await Promise.all(
        [
          ["index.astro", "qa-products-public.astro"],
          ["sheet.astro", "qa-products-sheet.astro"],
        ].map(async ([file, target]) => {
          let source = await readFile(
            join(root, "src/pages/products/[owner]/[slug]", file),
            "utf8",
          );
          source = source
            .replace(
              /import \{ publicProduct \} from ['"]@\/lib\/product-store['"];/,
              `if(!import.meta.env.DEV)return new Response(null,{status:404});\nconst publicProduct=async()=>{const query=new URLSearchParams({owner:Astro.url.searchParams.get('owner')??'',slug:Astro.url.searchParams.get('slug')??''});return (await(await fetch('${origin}/__preview-data?'+query)).json()).item;};`,
            )
            .replace(
              /publicProduct\(\s*Astro.locals,[^;]*?\)/gu,
              "publicProduct()",
            );
          return [target, source];
        }),
      )),
    ]) {
      const path = join(root, "src/pages/workspace", name);
      await writeFile(path, content, { flag: "wx" });
      pages.push(path);
    }
    server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(origin + req.url, {
          method: req.method,
          headers: req.headers,
          ...(!["GET", "HEAD"].includes(req.method) ? { body } : {}),
        });
        const response = await handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        console.error(error.message);
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("Local fixture error");
      }
    });
    await new Promise((resolve) => server.listen(13425, "127.0.0.1", resolve));
    console.log("LOCAL PRODUCT QA: " + origin + "/workspace/products/new");
    await new Promise((resolve) => process.once("SIGINT", resolve));
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const path of pages) await rm(path, { force: true });
    await queryDatabase(
      `delete from app.organizations where id in (select organization_id from app.organization_members where profile_id in (select id from app.profiles where clerk_user_id='${user}')) returning id`,
      null,
      true,
    );
    await queryDatabase(
      `delete from app.profiles where clerk_user_id='${user}' returning id`,
      null,
      true,
    );
  }
}
