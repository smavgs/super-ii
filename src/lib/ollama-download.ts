import { OLLAMA_REGISTRY, type OllamaFile } from "./ollama";

// Only registry-issued redirects to Ollama's blob delivery infrastructure.
function allowedBlobUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    (url.hostname === "registry.ollama.ai" ||
      /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname))
  );
}

export async function streamOllamaFile(
  request: Request,
  slug: string,
  file: OllamaFile,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const etag = `"${file.digest}"`;
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${file.filename}"`,
    "content-length": String(file.size),
    "accept-ranges": "bytes",
    etag,
    "cache-control": "private, no-store, no-transform",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (request.method === "HEAD") return new Response(null, { headers });
  const range = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const useRange = range && (!ifRange || ifRange === etag);
  let expectedStart = 0,
    expectedEnd = file.size - 1;
  if (useRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${file.size}` },
      });
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, file.size - Number(match[2]));
    const end =
      match[1] && match[2]
        ? Math.min(Number(match[2]), file.size - 1)
        : file.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= file.size
    ) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${file.size}` },
      });
    }
    expectedStart = start;
    expectedEnd = end;
  }
  const outgoing = new Headers({ "accept-encoding": "identity" });
  if (useRange) outgoing.set("range", `bytes=${expectedStart}-${expectedEnd}`);
  let url = `${OLLAMA_REGISTRY}/v2/library/${slug}/blobs/${file.digest}`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  // Timeout only until headers arrive. Long model transfers must keep streaming.
  const timer = setTimeout(() => controller.abort(), 25000);
  let upstream: Response;
  try {
    for (let redirects = 0; ; redirects++) {
      if (!allowedBlobUrl(url))
        throw new Error("Unsupported Ollama download destination.");
      upstream = await fetcher(url, {
        headers: outgoing,
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      await upstream.body?.cancel();
      if (redirects >= 3 || !upstream.headers.get("location"))
        throw new Error("Ollama download redirect failed.");
      url = new URL(upstream.headers.get("location")!, url).href;
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
  const expectedSize = expectedEnd - expectedStart + 1;
  if (
    upstream.status !== (useRange ? 206 : 200) ||
    !upstream.body ||
    (upstream.headers.has("content-length") &&
      Number(upstream.headers.get("content-length")) !== expectedSize) ||
    (useRange &&
      upstream.headers.get("content-range") !==
        `bytes ${expectedStart}-${expectedEnd}/${file.size}`)
  ) {
    await upstream.body?.cancel();
    throw new Error("Ollama could not deliver this file. Please try again.");
  }
  headers.set("content-length", String(expectedSize));
  if (useRange)
    headers.set(
      "content-range",
      `bytes ${expectedStart}-${expectedEnd}/${file.size}`,
    );
  // Return the upstream stream itself. No arrayBuffer/blob, cache, R2, or disk.
  // Cancellation of the returned body propagates to the upstream stream.
  return new Response(upstream.body, { status: useRange ? 206 : 200, headers });
}
