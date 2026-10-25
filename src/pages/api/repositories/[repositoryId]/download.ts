import type { APIRoute } from "astro";
import { sqlClient } from "@/lib/db";
import { canReadSdkRepository } from "@/lib/sdk-access";
import { runtimeFetch } from "@/lib/runtime";

const download: APIRoute = async ({ locals, params, request }) => {
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  const sql = sqlClient(locals);
  if (!sql)
    return Response.json(
      { error: "database unavailable" },
      { status: 503, headers },
    );
  const revision = new URL(request.url).searchParams.get("revision");
  if (!revision || !/^[a-f0-9]{64}$/.test(revision))
    return Response.json(
      { error: "Choose an exact published revision" },
      { status: 422, headers },
    );
  try {
    const rows =
      await sql`select id,kind,owner_handle,slug,visibility,status from app.repositories where id=${params.repositoryId ?? ""}::uuid limit 1`;
    const repository = rows[0];
    if (
      !repository ||
      !["model", "dataset"].includes(String(repository.kind)) ||
      !(await canReadSdkRepository(locals, request, sql, {
        id: String(repository.id),
        visibility: String(repository.visibility),
        status: String(repository.status),
      }))
    )
      return Response.json(
        { error: "repository unavailable" },
        { status: 404, headers },
      );
    const revisions =
      await sql`select id,commit_sha,manifest_sha256,file_count,total_size_bytes from app.repository_revisions
      where repository_id=${String(repository.id)}::uuid and commit_sha=${revision} and status='published' limit 1`;
    const release = revisions[0];
    if (!release)
      return Response.json(
        { error: "published revision unavailable" },
        { status: 404, headers },
      );
    // One upstream request regardless of file count. The runtime reads local
    // content-addressed objects and owns deterministic archive/range delivery.
    const forwarded = new Headers({ accept: "application/x-tar" });
    for (const name of ["range", "if-range"]) {
      const value = request.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    const upstream = await runtimeFetch(
      locals,
      `/v1/repositories/${repository.id}/revisions/${release.id}/download?commit=${revision}`,
      { method: request.method, headers: forwarded, signal: request.signal },
    );
    if (!upstream || ![200, 206, 416].includes(upstream.status)) {
      await upstream?.body?.cancel();
      return Response.json(
        { error: "Complete package is temporarily unavailable" },
        { status: 503, headers },
      );
    }
    const responseHeaders = new Headers(headers);
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "content-disposition",
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "Package download is temporarily unavailable" },
      { status: 503, headers },
    );
  }
};
export const GET = download;
export const HEAD = download;
