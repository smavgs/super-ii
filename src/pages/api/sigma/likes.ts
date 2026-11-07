import type { APIRoute } from "astro";
import { z } from "zod";
import { ensureAuthenticatedProfile, sameOrigin } from "@/lib/auth";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sqlClient } from "@/lib/db";
import { consumeIdentityRateLimit } from "@/lib/rate-limit";
import { sigmaJson } from "@/lib/sigma-http";

const input = z.object({ id: z.uuid(), active: z.boolean() }).strict();
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return sigmaJson({ error: "origin" }, 403);
  const parsed = await readBoundedJsonObject(request, 1024);
  if (!parsed.ok) return sigmaJson({ error: "invalid" }, parsed.status);
  const body = input.safeParse(parsed.value);
  if (!body.success) return sigmaJson({ error: "invalid" }, 400);
  const sql = sqlClient(locals);
  if (!sql) return sigmaJson({ error: "unavailable" }, 503);
  try {
    const profile = await ensureAuthenticatedProfile(locals, sql);
    if (!profile) return sigmaJson({ error: "sign_in" }, 401);
    const rate = await consumeIdentityRateLimit(locals, sql, profile.profileId, "sigma.like", 120, 3600);
    if (rate !== "allowed") return sigmaJson({ error: rate === "limited" ? "limited" : "unavailable" }, rate === "limited" ? 429 : 503);
    const rows = await sql`select app.sigma_story_engagement(${body.data.id}::uuid,${body.data.active}) as result`;
    return rows[0].result ? sigmaJson(rows[0].result) : sigmaJson({ error: "not_found" }, 404);
  } catch {
    return sigmaJson({ error: "unavailable" }, 503);
  }
};
