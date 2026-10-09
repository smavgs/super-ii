import { sqlClient } from "./db";
import {
  companyDocumentSchema,
  productDocumentSchema,
  type ProductDraft,
  type PublishedProduct,
} from "./products";

export function parsePublishedProduct(value: unknown): PublishedProduct | null {
  if (!value || typeof value !== "object") return null;
  const row = value as PublishedProduct;
  return {
    ...row,
    company: companyDocumentSchema.parse(row.company),
    product: productDocumentSchema.parse(row.product),
  };
}

export async function publicProduct(
  locals: App.Locals,
  owner: string,
  slug: string,
) {
  const sql = sqlClient(locals);
  if (!sql) throw new Error("Product service unavailable");
  const rows =
    await sql`select app.public_company_product(${owner},${slug}) as product`;
  return parsePublishedProduct(rows[0]?.product);
}

export async function searchProducts(
  locals: App.Locals,
  query = "",
  kind: string | null = null,
  owner: string | null = null,
  limit = 20,
  offset = 0,
) {
  const sql = sqlClient(locals);
  if (!sql) throw new Error("Product service unavailable");
  const rows =
    await sql`select value from app.search_company_products(${query},${kind},${owner},${limit},${offset}) as value`;
  return rows
    .map((row) => parsePublishedProduct(row.value))
    .filter((item): item is PublishedProduct => Boolean(item));
}

export async function productDraft(
  locals: App.Locals,
  id: string,
): Promise<ProductDraft | null> {
  const sql = sqlClient(locals);
  if (!sql) throw new Error("Product service unavailable");
  const rows =
    await sql`select app.company_product_draft(${id}::uuid) as draft`;
  return (rows[0]?.draft as ProductDraft | null) ?? null;
}

export async function companyWorkspace(locals: App.Locals) {
  const sql = sqlClient(locals);
  if (!sql) throw new Error("Product service unavailable");
  const rows = await sql`select app.company_product_workspace() as workspace`;
  return rows[0]?.workspace as {
    companies: Array<{
      id: string;
      handle: string;
      name: string;
      company: ProductDraft["company"];
      version: number;
    }>;
    products: Array<{
      id: string;
      owner: string;
      slug: string;
      name: string;
      kind: string;
      status: string;
      updated_at: string;
    }>;
  };
}
