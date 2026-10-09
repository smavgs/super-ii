import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders,
  productUuid,
} from "@/lib/product-http";
import { companyDocumentSchema, productDocumentSchema } from "@/lib/products";
const version = z.number().int().min(0);
const mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      version,
      company_version: version,
      company: companyDocumentSchema,
      product: productDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("publish"),
      version,
      company_version: version,
      authorized: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal("pause"), version }).strict(),
]);
export const GET: APIRoute = async ({ locals, request, params }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  if (!productUuid.test(params.productId ?? ""))
    return new Response(null, { status: 404, headers: productPrivateHeaders });
  try {
    const rows =
      await auth.sql`select app.company_product_draft(${params.productId}::uuid) as draft`;
    return Response.json(rows[0]?.draft ?? { error: "Product unavailable" }, {
      status: rows[0]?.draft ? 200 : 404,
      headers: productPrivateHeaders,
    });
  } catch (error) {
    return productError(error);
  }
};
export const POST: APIRoute = async ({ locals, request, params }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  if (!productUuid.test(params.productId ?? ""))
    return new Response(null, { status: 404, headers: productPrivateHeaders });
  const body = await readBoundedJsonObject(request, 180_000);
  if (!body.ok)
    return Response.json(
      { error: body.error },
      { status: body.status, headers: productPrivateHeaders },
    );
  const parsed = mutation.safeParse(body.value);
  if (!parsed.success)
    return Response.json(
      { error: "Review your details and publication confirmation." },
      { status: 422, headers: productPrivateHeaders },
    );
  const data = parsed.data;
  try {
    if (data.action === "save") {
      const rows =
        await auth.sql`select app.save_company_product(${params.productId}::uuid,${data.version},${data.company_version},${JSON.stringify(data.company)}::jsonb,${JSON.stringify(data.product)}::jsonb) as draft`;
      return Response.json(rows[0].draft, { headers: productPrivateHeaders });
    }
    if (data.action === "publish") {
      const rows =
        await auth.sql`select app.publish_company_product(${params.productId}::uuid,${data.version},${data.company_version},${data.authorized}) as draft`;
      return Response.json(rows[0].draft, { headers: productPrivateHeaders });
    }
    await auth.sql`select app.pause_company_product(${params.productId}::uuid,${data.version})`;
    const rows =
      await auth.sql`select app.company_product_draft(${params.productId}::uuid) as draft`;
    return Response.json(rows[0].draft, { headers: productPrivateHeaders });
  } catch (error) {
    return productError(error);
  }
};
