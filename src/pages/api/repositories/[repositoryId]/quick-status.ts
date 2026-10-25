import type { APIRoute } from "astro";
import { managedRepository } from "@/lib/creator";
import { sqlClient } from "@/lib/db";
import { authorizeRepositoryRequest } from "@/lib/scoped-auth";
export const GET: APIRoute = async ({ locals, params, request }) => {
  const headers = { "cache-control": "private, no-store" };
  const sql = sqlClient(locals);
  if (!sql)
    return Response.json(
      { error: "database unavailable" },
      { status: 503, headers },
    );
  const id = params.repositoryId ?? "";
  const auth = await authorizeRepositoryRequest(
    locals,
    request,
    sql,
    id,
    "repository:read",
    { allowSameOriginRead: true },
  );
  if (!auth.ok)
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  if (auth.actor.kind !== "profile")
    return Response.json(
      { error: "member session required" },
      { status: 403, headers },
    );
  const repo = await managedRepository(
    sql,
    id,
    auth.actor.profileId,
    new URL(request.url).searchParams.get("branch"),
  );
  if (!repo)
    return Response.json(
      { error: "repository unavailable" },
      { status: 404, headers },
    );
  const files =
    await sql`select path, sha256, size_bytes from app.repository_files
    where revision_id = ${repo.revision_id}::uuid and storage_state = 'available' and scan_status = 'clean' order by path`;
  return Response.json(
    {
      repository_id: repo.id,
      branch_id: repo.branch_id,
      revision_id: repo.revision_id,
      status: repo.revision_status,
      version: repo.presentation_version,
      title: repo.title,
      files,
      public_href: `/${repo.kind === "dataset" ? "datasets" : repo.kind === "model" ? "models" : "spaces"}/${encodeURIComponent(repo.owner_handle)}/${encodeURIComponent(repo.slug)}`,
    },
    { headers },
  );
};
