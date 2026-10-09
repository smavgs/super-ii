import type { APIRoute } from "astro";
import { publicProduct } from "@/lib/product-store";
import { productRepresentation } from "@/lib/products";
import {
  productPublicHeaders as headers,
  productPublicRate,
} from "@/lib/product-http";
export const GET: APIRoute = async ({ locals, request, params }) => {
  const rate = await productPublicRate(locals, request);
  if (rate) return rate;
  try {
    const item = await publicProduct(
      locals,
      params.owner ?? "",
      params.slug ?? "",
    );
    return Response.json(
      item ? productRepresentation(item) : { error: "Product unavailable" },
      { status: item ? 200 : 404, headers },
    );
  } catch {
    return Response.json(
      { error: "Product service unavailable" },
      { status: 503, headers },
    );
  }
};
