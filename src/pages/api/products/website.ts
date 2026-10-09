import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders as headers,
} from "@/lib/product-http";
import { matchesCompanyTxt } from "@/lib/product-source";
import { publicHttpsUrl } from "@/lib/products";
import { consumeRateLimit } from "@/lib/rate-limit";
const input = z
  .object({
    organization_id: z.uuid(),
    website: z.string().max(2048),
    action: z.enum(["start", "check"]),
  })
  .strict();
export const POST: APIRoute = async ({ locals, request }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  const body = await readBoundedJsonObject(request, 4096);
  const parsed = body.ok ? input.safeParse(body.value) : null;
  if (!parsed?.success)
    return Response.json(
      { error: "Add your company website and save first." },
      { status: 422, headers },
    );
  const data = parsed.data;
  const rate = await consumeRateLimit(
    locals,
    request,
    auth.sql,
    "products.website",
    10,
    3600,
  );
  if (rate !== "allowed")
    return Response.json(
      { error: "Please try the website check later." },
      { status: rate === "limited" ? 429 : 503, headers },
    );
  try {
    const hostname = new URL(publicHttpsUrl(data.website)).hostname;
    const rows =
      await auth.sql`select app.start_company_website_check(${data.organization_id}::uuid,${hostname}) as check`;
    const check = rows[0]?.check as {
      challenge: string;
      checked_at: string | null;
      expires_at: string;
    };
    if (data.action === "check" && !check.checked_at) {
      if (
        !(await matchesCompanyTxt(
          hostname,
          data.organization_id,
          check.challenge,
        ))
      )
        return Response.json(
          {
            error:
              "TXT record not found yet. Check the exact name and value, then try again later.",
          },
          { status: 422, headers },
        );
      const result =
        await auth.sql`select app.complete_company_website_check(${data.organization_id}::uuid,${hostname},${check.challenge}) as ok`;
      if (result[0]?.ok !== true)
        return Response.json(
          { error: "This check expired or the website changed. Start again." },
          { status: 409, headers },
        );
      check.checked_at = new Date().toISOString();
    }
    return Response.json(
      {
        hostname,
        record_name: `_superii.${hostname}`,
        record_value: `superii-company=${data.organization_id}:${check.challenge}`,
        expires_at: check.expires_at,
        checked_at: check.checked_at,
      },
      { headers },
    );
  } catch (error) {
    return productError(error);
  }
};
