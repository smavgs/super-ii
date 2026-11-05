import type { APIRoute } from "astro";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sigmaSaveSchema } from "@/lib/sigma-input";
import { sigmaJson, sigmaWriter } from "@/lib/sigma-http";
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const auth = await sigmaWriter(locals, request);
    if (auth.error) return auth.error;
    const body = await readBoundedJsonObject(request, 300_000);
    if (!body.ok) return sigmaJson({ error: "invalid" }, body.status);
    const parsed = sigmaSaveSchema.safeParse(body.value);
    if (!parsed.success)
      return sigmaJson(
        { error: "invalid", message: parsed.error.issues[0]?.message },
        400,
      );
    const d = parsed.data;
    const rows =
      await auth.sql`select app.sigma_save_story(${d.id}::uuid,${d.version},${d.slug},${d.action},${JSON.stringify(d.document)}::jsonb) as story`;
    return sigmaJson(rows[0].story);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("sigma_version_conflict"))
      return sigmaJson({ error: "conflict" }, 409);
    return sigmaJson({ error: "saveError" }, 400);
  }
};
