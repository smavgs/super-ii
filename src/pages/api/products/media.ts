import type { APIRoute } from "astro";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders,
  productUuid,
} from "@/lib/product-http";
import { showcaseBucket } from "@/lib/showcase-media";
export const GET: APIRoute = async ({ locals, request, url }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  const org = url.searchParams.get("organization_id");
  const id = url.searchParams.get("id");
  if (!org || !productUuid.test(org) || (id && !productUuid.test(id)))
    return new Response(null, { status: 404, headers: productPrivateHeaders });
  try {
    const rows =
      await auth.sql`select * from app.company_product_media(${org}::uuid)`;
    if (!id) {
      const quota =
        await auth.sql`select app.showcase_uploads_remaining() as remaining`;
      return Response.json(
        {
          remaining: Number(quota[0]?.remaining ?? 0),
          items: rows.map((row) => ({
            id: row.id,
            title: row.title,
            alt_text: row.alt_text,
            caption: row.caption,
            image_url: `/api/products/media?organization_id=${org}&id=${row.id}`,
          })),
        },
        { headers: productPrivateHeaders },
      );
    }
    const row = rows.find((row) => row.id === id);
    const bucket = showcaseBucket();
    if (!row || !bucket)
      return new Response(null, {
        status: 404,
        headers: productPrivateHeaders,
      });
    const object = await bucket.get(String(row.object_key));
    if (!object)
      return new Response(null, {
        status: 404,
        headers: productPrivateHeaders,
      });
    return new Response(object.body, {
      headers: {
        ...productPrivateHeaders,
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return productError(error);
  }
};
