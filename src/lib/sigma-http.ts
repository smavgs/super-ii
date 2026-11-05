import { ensureAuthenticatedProfile, sameOrigin } from "./auth";
import { sqlClient } from "./db";
import { consumeIdentityRateLimit } from "./rate-limit";

export const sigmaJson = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
export async function sigmaWriter(
  locals: App.Locals,
  request: Request,
  limit = 120,
) {
  if (!sameOrigin(request))
    return { error: sigmaJson({ error: "origin" }, 403) } as const;
  const sql = sqlClient(locals);
  if (!sql) return { error: sigmaJson({ error: "unavailable" }, 503) } as const;
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return { error: sigmaJson({ error: "sign_in" }, 401) } as const;
  const rate = await consumeIdentityRateLimit(
    locals,
    sql,
    profile.profileId,
    "sigma.write",
    limit,
    3600,
  );
  if (rate !== "allowed")
    return {
      error: sigmaJson(
        { error: rate === "limited" ? "limited" : "unavailable" },
        rate === "limited" ? 429 : 503,
      ),
    } as const;
  return { sql, profile } as const;
}
