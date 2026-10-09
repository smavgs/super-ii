import type { APIRoute } from "astro";
import { publicProduct } from "@/lib/product-store";
import { answerProductQuestion } from "@/lib/products";
import {
  productPublicHeaders as headers,
  productPublicRate,
} from "@/lib/product-http";
export const GET: APIRoute = async ({ locals, request, params, url }) => {
  const rate = await productPublicRate(locals, request);
  if (rate) return rate;
  const q = url.searchParams.get("question") ?? "";
  if (!q.trim() || q.length > 500)
    return Response.json(
      { error: "Ask a question of 1–500 characters." },
      { status: 422, headers },
    );
  try {
    const item = await publicProduct(
      locals,
      params.owner ?? "",
      params.slug ?? "",
    );
    return Response.json(
      item
        ? answerProductQuestion(
            item,
            q,
            "https://superii.site",
            url.searchParams.get("locale") ?? "en",
          )
        : { error: "Product unavailable" },
      { status: item ? 200 : 404, headers },
    );
  } catch {
    return Response.json(
      { error: "Product service unavailable" },
      { status: 503, headers },
    );
  }
};
