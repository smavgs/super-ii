import { ensureAuthenticatedProfile, sameOrigin } from "./auth";
import { sqlClient } from "./db";
import { consumeRateLimit } from "./rate-limit";

export const productPrivateHeaders = { "cache-control": "private, no-store" };
export const productPublicHeaders = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
};
export const productUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function trustedEditorRead(request: Request): boolean {
  if (request.method !== "GET" || request.headers.has("origin")) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  try {
    return (
      new URL(request.headers.get("referer") ?? "").origin ===
      new URL(request.url).origin
    );
  } catch {
    return false;
  }
}

export async function authorizeProductEditor(
  locals: App.Locals,
  request: Request,
) {
  if (!sameOrigin(request) && !trustedEditorRead(request))
    return {
      ok: false as const,
      response: Response.json(
        { error: "Invalid origin" },
        { status: 403, headers: productPrivateHeaders },
      ),
    };
  const sql = sqlClient(locals);
  if (!sql)
    return {
      ok: false as const,
      response: Response.json(
        { error: "Product service unavailable" },
        { status: 503, headers: productPrivateHeaders },
      ),
    };
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile)
    return {
      ok: false as const,
      response: Response.json(
        { error: "Sign in to save your work." },
        { status: 401, headers: productPrivateHeaders },
      ),
    };
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    request.method === "GET" ? "products.editor.read" : "products.editor.write",
    120,
    3600,
  );
  if (rate !== "allowed")
    return {
      ok: false as const,
      response: Response.json(
        {
          error:
            rate === "limited"
              ? "Please wait before trying again."
              : "Product service unavailable",
        },
        {
          status: rate === "limited" ? 429 : 503,
          headers: productPrivateHeaders,
        },
      ),
    };
  return { ok: true as const, sql, profile };
}

export async function productPublicRate(
  locals: App.Locals,
  request: Request,
): Promise<Response | null> {
  const sql = sqlClient(locals);
  if (!sql)
    return Response.json(
      { error: "Product service unavailable" },
      { status: 503, headers: productPublicHeaders },
    );
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    "products.public",
    300,
    3600,
  );
  return rate === "allowed"
    ? null
    : Response.json(
        {
          error:
            rate === "limited"
              ? "Please wait before trying again."
              : "Product service unavailable",
        },
        {
          status: rate === "limited" ? 429 : 503,
          headers: productPublicHeaders,
        },
      );
}

export function productError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const [status, text] = /version_conflict/u.test(message)
    ? [409, "This draft changed in another tab. Reload it before saving."]
    : /permission_denied|reference_denied/u.test(message)
      ? [403, "This company, image or Card is not available to you."]
      : /unique|already exists|duplicate/u.test(message)
        ? [409, "That address is already in use. Choose another address."]
        : /limit_reached/u.test(message)
          ? [409, "This company has reached its product limit."]
          : /not_ready|invalid|confirmation_required|does_not_match/u.test(
                message,
              )
            ? [422, "Review the required details and permission to publish."]
            : [503, "Your work could not be saved. Please try again."];
  return Response.json(
    { error: text },
    { status: Number(status), headers: productPrivateHeaders },
  );
}
