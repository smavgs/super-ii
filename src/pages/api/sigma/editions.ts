import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { sigmaJson, sigmaWriter } from "@/lib/sigma-http";
import {
  sigmaMailConfig,
  sigmaToken,
  sigmaDigest,
  sendSigmaMail,
  SigmaMailError,
  type SigmaEditionStory,
} from "@/lib/sigma-email";
import type { SigmaLocale } from "@/lib/sigma-input";
import { sigmaAccess } from "@/lib/sigma";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare"),
      id: z.uuid(),
      stories: z.array(z.uuid()).min(1).max(15),
    })
    .strict(),
  z
    .object({ action: z.literal("send"), id: z.uuid(), confirmation: z.uuid() })
    .strict(),
]);
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const auth = await sigmaWriter(locals, request, 3600);
    if (auth.error) return auth.error;
    const body = await readBoundedJsonObject(request, 4000);
    if (!body.ok) return sigmaJson({ error: "invalid" }, body.status);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return sigmaJson({ error: "invalid" }, 400);
    const d = parsed.data;
    if (d.action === "prepare") {
      const rows =
        await auth.sql`select app.sigma_prepare_edition(${d.id}::uuid,${d.stories}::uuid[]) as edition`;
      return sigmaJson(rows[0].edition);
    }
    if (d.id !== d.confirmation || !(await sigmaAccess(auth.sql)).admin)
      return sigmaJson({ error: "not_allowed" }, 403);
    const config = sigmaMailConfig(locals);
    if (!config) return sigmaJson({ error: "unavailable" }, 503);
    const rows =
      (await auth.sql`select * from app.sigma_claim_deliveries(${d.id}::uuid)`) as Array<{
        id: string;
        email: string;
        locale: SigmaLocale;
        subscriber_id: string;
        token_version: string;
        stories: SigmaEditionStory[];
        created_at: string;
      }>;
    for (const row of rows) {
      const token = await sigmaToken(
        config.secret,
        "manage",
        row.subscriber_id,
        row.token_version,
      );
      const manage = `${config.origin}/sigma/subscription?token=${token}&language=${row.locale}`;
      try {
        // Recheck consent immediately before each network send, including resumed batches.
        const current =
          await auth.sql`select app.sigma_subscription_state(${row.subscriber_id}::uuid) as subscription`;
        if (
          current[0].subscription?.status !== "active" ||
          current[0].subscription?.version !== row.token_version
        )
          continue;
        const provider = await sendSigmaMail(config, {
          ...sigmaDigest(
            row.locale,
            row.stories,
            config.origin,
            manage,
            row.created_at,
          ),
          to: row.email,
          key: `sigma-edition/${row.id}`,
          unsubscribe: `${config.origin}/api/sigma/subscription?token=${token}`,
        });
        await auth.sql`select app.sigma_finish_delivery(${row.id}::uuid,${provider},false)`;
      } catch (error) {
        if (error instanceof SigmaMailError && error.definitive)
          await auth.sql`select app.sigma_finish_delivery(${row.id}::uuid,null,true)`;
        // Timeout/5xx may have been accepted: leave sending for idempotent retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const editions =
      await auth.sql`select app.sigma_editions_list() as edition`;
    return sigmaJson({
      processed: rows.length,
      edition: editions.find((row) => row.edition.id === d.id)?.edition,
    });
  } catch {
    return sigmaJson({ error: "unavailable" }, 503);
  }
};
