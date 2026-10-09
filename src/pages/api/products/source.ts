import type { APIRoute } from "astro";
import { sameOrigin } from "@/lib/auth";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sqlClient } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { inspectProductSource } from "@/lib/product-source";
import { productPrivateHeaders as headers } from "@/lib/product-http";
export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const sql = sqlClient(locals);
  if (!sql)
    return Response.json(
      { error: "Suggestions unavailable. Enter your details manually." },
      { status: 503, headers },
    );
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    "products.source",
    10,
    3600,
  );
  if (rate !== "allowed")
    return Response.json(
      { error: "Suggestions unavailable. Enter your details manually." },
      { status: rate === "limited" ? 429 : 503, headers },
    );
  const body = await readBoundedJsonObject(request, 4096);
  if (!body.ok || typeof body.value.url !== "string")
    return Response.json(
      { error: "Use a public HTTPS link." },
      { status: 422, headers },
    );
  try {
    return Response.json(await inspectProductSource(body.value.url), {
      headers,
    });
  } catch {
    return Response.json(
      {
        error:
          "This website could not be read. You can enter the same details manually.",
      },
      { status: 422, headers },
    );
  }
};
