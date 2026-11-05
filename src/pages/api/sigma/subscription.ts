import type { APIRoute } from "astro";
import { sameOrigin } from "@/lib/auth";
import { sqlClient } from "@/lib/db";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sigmaJson } from "@/lib/sigma-http";
import { sigmaMailConfig, verifySigmaToken } from "@/lib/sigma-email";
import { sigmaLocales } from "@/lib/sigma-input";
export const GET: APIRoute = ({ url }) => {
  const token = url.searchParams.get("token") ?? "";
  return new Response(null, {
    status: 303,
    headers: {
      location: `/sigma/subscription?${new URLSearchParams({ token })}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
};
export const POST: APIRoute = async ({ locals, request, url }) => {
  const sql = sqlClient(locals);
  const config = sigmaMailConfig(locals);
  if (!sql || !config) return sigmaJson({ error: "unavailable" }, 503);
  try {
    // RFC 8058: email providers can POST this token URL without an Origin header.
    const oneClick = url.searchParams.get("token");
    let token: string;
    let action: string;
    let locale: string | null = null;
    if (oneClick) {
      if (Number(request.headers.get("content-length") ?? 0) > 200)
        return sigmaJson({ error: "invalid" }, 413);
      if (
        request.headers.get("content-type")?.split(";")[0] !==
        "application/x-www-form-urlencoded"
      )
        return sigmaJson({ error: "invalid" }, 415);
      const reader = request.body?.getReader();
      if (!reader) return sigmaJson({ error: "invalid" }, 400);
      let raw = "";
      let size = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 200) {
          await reader.cancel();
          return sigmaJson({ error: "invalid" }, 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
      if (new URLSearchParams(raw).get("List-Unsubscribe") !== "One-Click")
        return sigmaJson({ error: "invalid" }, 400);
      // Token possession authorizes only unsubscribe; no cookie or profile authority is used.
      token = oneClick;
      action = "unsubscribe";
    } else {
      if (!sameOrigin(request)) return sigmaJson({ error: "origin" }, 403);
      const body = await readBoundedJsonObject(request, 2000);
      if (!body.ok) return sigmaJson({ error: "invalid" }, body.status);
      token = String(body.value.token ?? "");
      action = String(body.value.action ?? "");
      locale = sigmaLocales.includes(
        body.value.locale as (typeof sigmaLocales)[number],
      )
        ? String(body.value.locale)
        : null;
    }
    if (!["confirm", "unsubscribe", "language"].includes(action))
      return sigmaJson({ error: "invalid" }, 400);
    const parsed = await verifySigmaToken(
      config.secret,
      action === "confirm" ? "confirm" : "manage",
      token,
    );
    if (!parsed) return sigmaJson({ error: "expired" }, 400);
    const rows =
      await sql`select app.sigma_subscription_action(${parsed.id}::uuid,${parsed.nonce}::uuid,${action},${locale}) as ok`;
    if (oneClick)
      return new Response(null, {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    return sigmaJson(
      { ok: rows[0].ok === true, error: rows[0].ok ? undefined : "expired" },
      rows[0].ok ? 200 : 400,
    );
  } catch {
    return sigmaJson({ error: "unavailable" }, 503);
  }
};
