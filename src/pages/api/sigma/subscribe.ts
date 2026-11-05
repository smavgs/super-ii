import type { APIRoute } from "astro";
import { sameOrigin } from "@/lib/auth";
import { sqlClient } from "@/lib/db";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { consumeRateLimit, consumeIdentityRateLimit } from "@/lib/rate-limit";
import { sigmaSubscribeSchema } from "@/lib/sigma-input";
import { sigmaJson } from "@/lib/sigma-http";
import {
  sigmaConfirmation,
  sigmaMailConfig,
  sigmaToken,
  sendSigmaMail,
} from "@/lib/sigma-email";
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return sigmaJson({ error: "origin" }, 403);
  const sql = sqlClient(locals);
  const config = sigmaMailConfig(locals);
  if (!sql || !config) return sigmaJson({ error: "unavailable" }, 503);
  try {
    const body = await readBoundedJsonObject(request, 3000);
    if (!body.ok) return sigmaJson({ error: "invalid" }, body.status);
    const parsed = sigmaSubscribeSchema.safeParse(body.value);
    if (!parsed.success) return sigmaJson({ error: "invalid" }, 400);
    if (parsed.data.website) return sigmaJson({ ok: true });
    const { email, locale } = parsed.data;
    const network = await consumeRateLimit(
      locals,
      request,
      sql,
      "sigma.subscribe",
      5,
      3600,
    );
    if (network !== "allowed")
      return sigmaJson(
        { error: network === "limited" ? "limited" : "unavailable" },
        network === "limited" ? 429 : 503,
      );
    const identity = await consumeIdentityRateLimit(
      locals,
      sql,
      email,
      "sigma.subscribe.email",
      3,
      3600,
    );
    if (identity !== "allowed") return sigmaJson({ ok: true });
    const rows =
      await sql`select app.sigma_request_subscription(${email},${locale}) as subscription`;
    const subscription = rows[0].subscription as {
      id: string;
      nonce: string;
    } | null;
    if (subscription) {
      const token = await sigmaToken(
        config.secret,
        "confirm",
        subscription.id,
        subscription.nonce,
      );
      const href = `${config.origin}/sigma/confirm?token=${token}&language=${locale}`;
      await sendSigmaMail(config, {
        ...sigmaConfirmation(locale, href),
        to: email,
        key: `sigma-confirm/${subscription.id}/${subscription.nonce}`,
      });
    }
    return sigmaJson({ ok: true });
  } catch {
    return sigmaJson({ error: "unavailable" }, 503);
  }
};
