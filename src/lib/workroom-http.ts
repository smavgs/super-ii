import { ensureAuthenticatedProfile, sameOrigin } from "./auth";
import { sqlClient } from "./db";
import { consumeRateLimit } from "./rate-limit";
export const workroomHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
export function workroomJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: workroomHeaders });
}
export function workroomError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/permission_denied|reference_denied/.test(message))
    return workroomJson(
      { error: "This workroom or source is unavailable to you." },
      403,
    );
  if (/version_conflict/.test(message))
    return workroomJson(
      {
        error:
          "Another update arrived. Copy your unsaved text, then reload before saving.",
      },
      409,
    );
  if (/retry_conflict/.test(message))
    return workroomJson(
      {
        error:
          "This retry differs from the saved request. Reload to check the saved result.",
      },
      409,
    );
  if (/review_required/.test(message))
    return workroomJson(
      {
        error:
          "Add a result and select the result you reviewed before marking work complete.",
      },
      422,
    );
  if (/member_unavailable/.test(message))
    return workroomJson(
      { error: "Use the exact handle of an existing public member profile." },
      422,
    );
  if (/limit|archived/.test(message))
    return workroomJson(
      {
        error:
          "The workroom is archived or its storage limit has been reached.",
      },
      409,
    );
  if (/invalid/.test(message))
    return workroomJson({ error: "Review the required fields." }, 422);
  return workroomJson(
    {
      error:
        "Workrooms are temporarily unavailable. Your unsaved text is still here.",
    },
    503,
  );
}
export async function workroomMember(locals: App.Locals, request: Request) {
  const read = request.method === "GET";
  if (!read && !sameOrigin(request))
    return {
      ok: false as const,
      response: workroomJson({ error: "Invalid origin" }, 403),
    };
  const sql = sqlClient(locals);
  if (!sql)
    return {
      ok: false as const,
      response: workroomJson({ error: "Workrooms unavailable" }, 503),
    };
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile)
    return {
      ok: false as const,
      response: workroomJson({ error: "Sign in to open your workrooms." }, 401),
    };
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    read ? "workroom.read" : "workroom.write",
    read ? 240 : 120,
    3600,
  );
  if (rate !== "allowed")
    return {
      ok: false as const,
      response: workroomJson(
        { error: "Please wait before trying again." },
        rate === "limited" ? 429 : 503,
      ),
    };
  return { ok: true as const, sql, profile };
}
