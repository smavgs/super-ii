import { z } from "zod";
import { productKinds, productSlug } from "./products";
export const productLookupInput = z
  .object({ owner: productSlug, slug: productSlug })
  .strict();
export const productSearchInput = z
  .object({
    query: z.string().trim().max(120).default(""),
    kind: z.enum(productKinds).optional(),
    owner: productSlug.optional(),
    limit: z.number().int().min(1).max(20).default(10),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const productQuestionInput = productLookupInput
  .extend({
    question: z.string().trim().min(1).max(500),
    locale: z.enum(["en", "zh-CN", "ru"]).default("en"),
  })
  .strict();
