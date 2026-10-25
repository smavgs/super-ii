import type { APIRoute } from "astro";
import { ensureAuthenticatedProfile, sameOrigin } from "@/lib/auth";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sqlClient } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  canonicalDriveLink,
  shareFormats,
  type ShareKind,
} from "@/lib/quick-share";
export const POST: APIRoute = async ({ locals, request }) => {
  const headers = { "cache-control": "private, no-store" };
  if (!sameOrigin(request))
    return Response.json({ error: "invalid origin" }, { status: 403, headers });
  const sql = sqlClient(locals);
  if (!sql)
    return Response.json(
      { error: "database unavailable" },
      { status: 503, headers },
    );
  const actor = await ensureAuthenticatedProfile(locals, sql);
  if (!actor)
    return Response.json(
      { error: "authentication required" },
      { status: 401, headers },
    );
  const profiles =
    await sql`select is_public from app.profiles where id=${actor.profileId}::uuid`;
  if (profiles[0]?.is_public !== true)
    return Response.json(
      {
        error:
          "Make your profile public in Workspace before sharing a public Drive link.",
      },
      { status: 422, headers },
    );
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    "bridge.drive-link",
    30,
    86400,
  );
  if (rate !== "allowed")
    return Response.json(
      {
        error:
          rate === "limited"
            ? "daily linked work limit reached"
            : "safety service unavailable",
      },
      { status: rate === "limited" ? 429 : 503, headers },
    );
  const parsed = await readBoundedJsonObject(request, 8192);
  if (!parsed.ok)
    return Response.json(
      { error: parsed.error },
      { status: parsed.status, headers },
    );
  const data = parsed.value;
  const url = canonicalDriveLink(
    typeof data.drive_url === "string" ? data.drive_url : "",
  );
  const kind = String(data.kind) as ShareKind;
  const title = String(data.title ?? "").trim();
  const license = String(data.license ?? "").trim();
  const basis = String(data.basis ?? "");
  const format = String(data.format ?? "");
  const source = String(data.source_url ?? "");
  if (
    !url ||
    !["model", "dataset"].includes(kind) ||
    !shareFormats[kind]?.includes(format as never) ||
    title.length < 2 ||
    title.length > 200 ||
    !license ||
    license.length > 120 ||
    data.confirmed !== true ||
    data.download_confirmed !== true ||
    !["original", "permission", "licensed-redistribution"].includes(basis)
  )
    return Response.json(
      {
        error:
          "Confirm the name, format, license, public sharing rights and visitor access.",
      },
      { status: 422, headers },
    );
  if (basis !== "original") {
    try {
      const original = new URL(source);
      if (
        source.length > 2048 ||
        original.protocol !== "https:" ||
        original.username ||
        original.password
      )
        throw new Error();
    } catch {
      return Response.json(
        { error: "Provide an HTTPS original source URL" },
        { status: 422, headers },
      );
    }
  }
  try {
    const rights = {
      confirmed: true,
      download_confirmed: true,
      basis,
      source_url: basis === "original" ? null : source,
    };
    const rows =
      await sql`select app.link_drive_catalog_item(${kind}::repository_kind,${url},${title},${license},${format},${JSON.stringify(rights)}::jsonb) as id`;
    return Response.json(
      { ok: true, id: rows[0].id, href: `/linked/${rows[0].id}` },
      { status: 201, headers },
    );
  } catch {
    return Response.json(
      {
        error:
          "The link could not be shared. Check your linked-work limit and retry.",
      },
      { status: 422, headers },
    );
  }
};
