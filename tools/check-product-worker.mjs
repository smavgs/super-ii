import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

// Use the runtime installed with the locked, directly declared Wrangler version.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { outputFiles } = await build({
  stdin: {
    resolveDir: resolve(import.meta.dirname, ".."),
    contents: `
      import { inspectProductSource, dnsRecords, matchesCompanyTxt } from './src/lib/product-source.ts';
      export default {
        async fetch() {
          try {
            const requests = [];
            const transport = async (url, options) => {
              // Workerd validates RequestInit differently from Node. In particular,
              // redirect: "error" throws before any DNS request can be made.
              const request = new Request(url, options);
              requests.push(request.url);
              const target = new URL(request.url);
              if (target.hostname === 'cloudflare-dns.com') {
                const type = target.searchParams.get('type');
                return Response.json({ Status: 0, Answer: type === 'TXT'
                  ? [{ type: 16, data: '"superii-company=fixture:challenge"' }]
                  : [{ type: type === 'A' ? 1 : 28, data: type === 'A' ? '8.8.8.8' : '2606:4700:4700::1111' }] });
              }
              if (target.href !== 'https://example.com/') throw new Error('Unexpected source request');
              return new Response('<title>Runtime product</title><meta name="description" content="Public metadata">',
                { headers: { 'content-type': 'text/html; charset=utf-8' } });
            };
            const suggestions = await inspectProductSource('https://example.com', transport);
            const websiteControl = await matchesCompanyTxt('example.com', 'fixture', 'challenge', transport);
            let redirectedDnsRejected = false;
            try {
              await dnsRecords('example.com', 'A', async (url, options) => {
                new Request(url, options);
                return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } });
              });
            } catch { redirectedDnsRejected = true; }
            return Response.json({ suggestions, websiteControl, redirectedDnsRejected, requests });
          } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
          }
        }
      }`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  logLevel: "silent",
});

const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: outputFiles[0].text,
  compatibilityDate: "2026-08-27",
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
}));
try {
  const response = await runtime.dispatchFetch("http://localhost/");
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.suggestions.product_name, "Runtime product");
  assert.equal(result.suggestions.summary, "Public metadata");
  assert.equal(result.suggestions.source_url, "https://example.com/");
  assert.equal(result.websiteControl, true);
  assert.equal(result.redirectedDnsRejected, true);
  assert.equal(result.requests.length, 4);
  console.log("Product Worker check passed: metadata and TXT reads work; DNS redirects are rejected.");
} finally {
  await runtime.dispose();
}
