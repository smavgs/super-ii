import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders,
  productPublicHeaders,
  productPublicRate,
} from "@/lib/product-http";
import {
  companyDocumentSchema,
  productDocumentSchema,
  productKinds,
  productRepresentation,
  productSlug,
} from "@/lib/products";
import { searchProducts } from "@/lib/product-store";

const creation = z
  .object({
    creation_key: z.uuid(),
    organization_id: z.uuid().nullable(),
    handle: productSlug.max(40),
    company: companyDocumentSchema,
    product: productDocumentSchema,
    slug: productSlug,
    company_version: z.number().int().min(0),
  })
  .strict();
export const POST: APIRoute = async ({ locals, request }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  const body = await readBoundedJsonObject(request, 180_000);
  if (!body.ok)
    return Response.json(
      { error: body.error },
      { status: body.status, headers: productPrivateHeaders },
    );
  const parsed = creation.safeParse(body.value);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Review the form." },
      { status: 422, headers: productPrivateHeaders },
    );
  const data = parsed.data;
  try {
    const rows =
      await auth.sql`select app.start_company_product(${data.creation_key}::uuid,${data.organization_id}::uuid,${data.handle},${JSON.stringify(data.company)}::jsonb,${data.slug},${JSON.stringify(data.product)}::jsonb,${data.company_version}) as id`;
    const draft =
      await auth.sql`select app.company_product_draft(${rows[0].id}::uuid) as draft`;
    return Response.json(draft[0].draft, {
      status: 201,
      headers: productPrivateHeaders,
    });
  } catch (error) {
    return productError(error);
  }
};
export const GET: APIRoute = async ({ locals, request, url }) => {
  const rate = await productPublicRate(locals, request);
  if (rate) return rate;
  const q = url.searchParams.get("q") ?? "";
  const kind = url.searchParams.get("kind");
  const owner = url.searchParams.get("owner");
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (
    q.length > 120 ||
    (kind && !productKinds.includes(kind as (typeof productKinds)[number])) ||
    (owner && !productSlug.safeParse(owner).success) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    return Response.json(
      { error: "Invalid search" },
      { status: 422, headers: productPublicHeaders },
    );
  try {
    const items = await searchProducts(locals, q, kind, owner, 20, offset);
    return Response.json(
      {
        items: items.map((item) => productRepresentation(item)),
        offset,
        next_offset: items.length === 20 && offset + 20 <= 10000 ? offset + 20 : null,
      },
      { headers: productPublicHeaders },
    );
  } catch {
    return Response.json(
      { error: "Product search unavailable" },
      { status: 503, headers: productPublicHeaders },
    );
  }
};
