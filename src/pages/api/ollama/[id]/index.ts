import type { APIRoute } from "astro";
import { sqlClient } from "@/lib/db";
import { ensureAuthenticatedProfile, sameOrigin } from "@/lib/auth";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { consumeRateLimit } from "@/lib/rate-limit";

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const headers = { "cache-control": "private, no-store" };
  const error = (message: string, status: number) =>
    Response.json({ error: message }, { status, headers });
  if (!sameOrigin(request)) return error("Invalid origin.", 403);
  if (!/^[a-f0-9-]{36}$/.test(params.id ?? ""))
    return error("Invalid listing.", 400);
  const sql = sqlClient(locals);
  if (!sql) return error("Editing is temporarily unavailable.", 503);
  const actor = await ensureAuthenticatedProfile(locals, sql);
  if (!actor) return error("Sign in to edit your listing.", 401);
  const body = await readBoundedJsonObject(request, 110000);
  if (!body.ok) return error(body.error, body.status);
  const { title, summary, card_markdown: card } = body.value;
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 200 ||
    typeof summary !== "string" ||
    summary.length > 2000 ||
    typeof card !== "string" ||
    new TextEncoder().encode(card).length > 100000
  )
    return error("Check the title, summary and model card lengths.", 422);
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    "ollama.edit",
    60,
    3600,
  );
  if (rate !== "allowed")
    return error("Please try again later.", rate === "limited" ? 429 : 503);
  try {
    await sql`select app.update_ollama_catalog_item(${params.id}::uuid,${title},${summary},${card})`;
    return Response.json({ ok: true }, { headers });
  } catch {
    return error(
      "Only this listing’s owner or organization administrator can edit it.",
      403,
    );
  }
};
