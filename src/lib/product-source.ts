import { publicHttpsUrl } from "./products";

async function boundedBody(response: Response, limit: number): Promise<string> {
  if (
    Number(response.headers.get("content-length") ?? 0) > limit ||
    !response.body
  )
    throw new Error("Source is too large or unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("Source is too large.");
      body += decoder.decode(next.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function dnsRecords(
  hostname: string,
  type: "A" | "AAAA" | "TXT",
  transport: typeof fetch = fetch,
) {
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);
  const response = await transport(endpoint, {
    headers: { accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok)
    throw new Error("The website could not be checked. Please try again.");
  const data = JSON.parse(await boundedBody(response, 32000)) as {
    Status?: number;
    Answer?: Array<{ type: number; data: string }>;
  };
  if (data.Status !== 0 && data.Status !== 3)
    throw new Error("The website could not be checked. Please try again.");
  return (data.Answer ?? []).filter(
    (answer) => typeof answer.data === "string",
  );
}

export function publicAddress(address: string): boolean {
  if (address.includes(":")) {
    if (!/^[\da-f:]+$/iu.test(address)) return false;
    const [first, second] = address
      .toLowerCase()
      .split(":")
      .map((piece) => Number.parseInt(piece || "0", 16));
    return (
      first >= 0x2000 &&
      first < 0x4000 &&
      first !== 0x2002 &&
      first !== 0x3fff &&
      !(first === 0x2001 && (second < 0x0200 || second === 0x0db8))
    );
  }
  const pieces = address.split(".");
  if (
    pieces.length !== 4 ||
    pieces.some((piece) => !/^\d{1,3}$/u.test(piece) || Number(piece) > 255)
  )
    return false;
  const [a, b, c] = pieces.map(Number);
  return (
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0 && c === 113)
  );
}

async function requirePublicHost(hostname: string, transport: typeof fetch) {
  if (hostname === "superii.site" || hostname.endsWith(".superii.site"))
    throw new Error("Use your company or product website.");
  const answers = (
    await Promise.all([
      dnsRecords(hostname, "A", transport),
      dnsRecords(hostname, "AAAA", transport),
    ])
  ).flat();
  const addresses = answers.filter(
    (answer) => answer.type === 1 || answer.type === 28,
  );
  if (
    !addresses.length ||
    addresses.some((answer) => !publicAddress(answer.data))
  )
    throw new Error("Use a publicly accessible website.");
}

function plain(value: string) {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(?:x([a-f\d]+)|(\d+));/giu, (_all, hex, decimal) => {
      const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return code > 31 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp);/gu,
      (_all, name: string) =>
        ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[
          name
        ] ?? " ",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

/** Read metadata as suggestions. No script, prompt, linked page or embedded code executes. */
export function sourceSuggestions(html: string, source: string) {
  const meta = new Map<string, string>();
  for (const tag of html.slice(0, 256000).match(/<meta\b[^>]{0,4096}>/giu) ??
    []) {
    const attrs = new Map<string, string>();
    for (const attr of tag.matchAll(
      /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
    )) {
      attrs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const key = attrs.get("property") || attrs.get("name");
    if (key && attrs.has("content") && !meta.has(key.toLowerCase()))
      meta.set(key.toLowerCase(), plain(attrs.get("content")!));
  }
  let image = "";
  try {
    if (meta.get("og:image"))
      image = publicHttpsUrl(new URL(meta.get("og:image")!, source).href);
  } catch {
    /* Optional source media stays absent. */
  }
  return {
    source_url: source,
    hostname: new URL(source).hostname,
    company_name: (meta.get("og:site_name") ?? "").slice(0, 160),
    product_name: (
      meta.get("og:title") ||
      plain(
        html.match(/<title\b[^>]{0,1024}>([\s\S]{0,2048}?)<\/title>/iu)?.[1] ??
          "",
      )
    ).slice(0, 160),
    summary: (
      meta.get("og:description") ||
      meta.get("description") ||
      ""
    ).slice(0, 600),
    suggested_image_url: image,
    evidence: "website-metadata-suggestion" as const,
    notice:
      "Review and correct these suggestions. They do not verify ownership or product claims.",
  };
}

export async function inspectProductSource(
  value: string,
  transport: typeof fetch = fetch,
) {
  let current = publicHttpsUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(current);
    await requirePublicHost(url.hostname, transport);
    const response = await transport(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Super-ii-Product-Preview/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3)
        throw new Error(
          "The website redirected too many times. Enter details manually.",
        );
      current = publicHttpsUrl(new URL(location, current).href);
      continue;
    }
    if (
      !response.ok ||
      !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      await response.body?.cancel();
      throw new Error(
        "This website could not be read. You can enter the details manually.",
      );
    }
    return sourceSuggestions(await boundedBody(response, 256000), current);
  }
  throw new Error("The website could not be read.");
}

export async function matchesCompanyTxt(
  hostname: string,
  organization: string,
  challenge: string,
  transport: typeof fetch = fetch,
) {
  const expected = `superii-company=${organization}:${challenge}`;
  const answers = await dnsRecords(`_superii.${hostname}`, "TXT", transport);
  return answers.some(
    (answer) =>
      answer.type === 16 &&
      answer.data.replace(/"\s*"/gu, "").replace(/^"|"$/gu, "") === expected,
  );
}
