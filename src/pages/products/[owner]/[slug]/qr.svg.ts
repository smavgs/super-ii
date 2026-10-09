import type { APIRoute } from "astro";
import QRCode from "qrcode";
import { publicProduct } from "@/lib/product-store";
import { productPath } from "@/lib/products";
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
    if (!item)
      return new Response("Product unavailable", { status: 404, headers });
    const svg = await QRCode.toString(
      `https://superii.site${productPath(item.owner, item.slug)}`,
      {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 720,
        color: { dark: "#071a2f", light: "#ffffff" },
      },
    );
    return new Response(svg, {
      headers: {
        ...headers,
        "content-type": "image/svg+xml; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return new Response("Product service unavailable", {
      status: 503,
      headers,
    });
  }
};
