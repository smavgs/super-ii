import { z } from "zod";

export const sigmaLocales = ["en", "ru", "zh-CN"] as const;
export type SigmaLocale = (typeof sigmaLocales)[number];
export const sigmaCategories = [
  "models",
  "research",
  "agents",
  "robotics",
  "hardware",
  "community",
] as const;
const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS source link.");
const translation = z
  .object({
    title: z.string().trim().min(3).max(300),
    summary: z.string().trim().max(500),
    body: z.string().trim().min(1).max(30_000),
  })
  .strict();
export const sigmaDocumentSchema = z
  .object({
    source_language: z.enum(sigmaLocales),
    category: z.enum(sigmaCategories),
    translations: z
      .object({
        en: translation.optional(),
        ru: translation.optional(),
        "zh-CN": translation.optional(),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({ label: z.string().trim().min(1).max(160), url: httpsUrl })
          .strict(),
      )
      .max(8),
    images: z
      .array(
        z
          .object({
            url: z
              .string()
              .regex(/^\/api\/sigma\/media\/[a-f0-9-]{36}\/[a-f0-9]{64}\.jpg$/),
            alt: z.string().trim().min(1).max(300),
            credit: z.string().trim().min(1).max(300),
            source_url: httpsUrl,
          })
          .strict(),
      )
      .max(2),
    rights_confirmed: z.boolean(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.translations[doc.source_language])
      ctx.addIssue({
        code: "custom",
        message: "Add the original language first.",
        path: ["translations"],
      });
  });
export type SigmaDocument = z.infer<typeof sigmaDocumentSchema>;
export const sigmaSaveSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().min(0),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/),
    action: z.enum(["save", "submit", "publish", "unpublish", "delete"]),
    document: sigmaDocumentSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      ["submit", "publish"].includes(input.action) &&
      (!input.document.rights_confirmed || !input.document.sources.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Add a source and confirm that the text and images may be published.",
      });
    }
  });
export const sigmaSubscribeSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    locale: z.enum(sigmaLocales),
    consent: z.literal(true),
    website: z.string().max(200).optional(),
  })
  .strict();
export function sigmaTranslation(document: SigmaDocument, locale: SigmaLocale) {
  const selected = document.translations[locale];
  return {
    text: selected ?? document.translations[document.source_language]!,
    language: selected ? locale : document.source_language,
    fallback: !selected,
  };
}
export function sigmaSlug(title: string, id: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || `story-${id.slice(0, 8)}`
  );
}
export function escapeSigmaHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
