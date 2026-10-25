// Proxy contract fixture only. Python tests independently extract the actual TAR.
export function packageFixture(
  options,
  content = new TextEncoder().encode("hello"),
) {
  const headers = new Headers(options.headers);
  const all = new Uint8Array(4096);
  all.set(content, 512);
  const etag = '"fixture-package"';
  const requested =
    headers.has("if-range") && headers.get("if-range") !== etag
      ? null
      : headers.get("range");
  const match = requested?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2]
    ? Math.min(Number(match[2]), all.length - 1)
    : all.length - 1;
  if (start >= all.length)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${all.length}` },
    });
  const result = all.subarray(start, end + 1);
  return new Response(options.method === "HEAD" ? null : result, {
    status: requested ? 206 : 200,
    headers: {
      "content-type": "application/x-tar",
      "content-length": String(result.length),
      "accept-ranges": "bytes",
      etag,
      "content-disposition": 'attachment; filename="fixture.tar"',
      ...(requested
        ? { "content-range": `bytes ${start}-${end}/${all.length}` }
        : {}),
    },
  });
}
