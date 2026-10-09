import type { APIRoute } from "astro";
import { publicProduct } from "@/lib/product-store";
import { productMarkdown } from "@/lib/products";
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
    return new Response(item ? productMarkdown(item) : "Product unavailable", {
      status: item ? 200 : 404,
      headers: { ...headers, "content-type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return new Response("Product service unavailable", {
      status: 503,
      headers,
    });
  }
};
