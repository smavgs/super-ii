import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sigmaJson, sigmaWriter } from "@/lib/sigma-http";
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const auth = await sigmaWriter(locals, request);
    if (auth.error) return auth.error;
    const body = await readBoundedJsonObject(request, 2000);
    if (!body.ok) return sigmaJson({ error: "invalid" }, body.status);
    const parsed = z
      .object({ handle: z.string().min(1).max(80), enabled: z.boolean() })
      .strict()
      .safeParse(body.value);
    if (!parsed.success) return sigmaJson({ error: "invalid" }, 400);
    await auth.sql`select app.sigma_set_editor(${parsed.data.handle},${parsed.data.enabled})`;
    return sigmaJson({ ok: true });
  } catch {
    return sigmaJson({ error: "not_allowed" }, 403);
  }
};
