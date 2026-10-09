import type { APIRoute } from "astro";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders,
} from "@/lib/product-http";
import { companyWorkspace } from "@/lib/product-store";
export const GET: APIRoute = async ({ locals, request }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await companyWorkspace(locals), {
      headers: productPrivateHeaders,
    });
  } catch (error) {
    return productError(error);
  }
};
