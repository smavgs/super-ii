import type { APIRoute } from "astro";
export const prerender = true;
const text = (maxLength: number) => ({ type: "string", maxLength });
const url = { type: "string", maxLength: 2048, pattern: "^(https://|$)" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const company = object({
  name: text(160),
  name_zh: text(160),
  summary: text(600),
  summary_zh: text(600),
  website: url,
  logo_url: url,
  email: text(254),
  phone: text(40),
  wechat: text(100),
  representative_card_url: text(200),
});
const product = object({
  name: text(160),
  name_zh: text(160),
  summary: text(600),
  summary_zh: text(600),
  description: text(12000),
  description_zh: text(12000),
  kind: { enum: ["model", "robot", "component", "hardware"] },
  stage: { enum: ["available", "prototype", "research", "discontinued"] },
  source_url: url,
  specs: {
    type: "array",
    maxItems: 20,
    items: object({
      label: text(100),
      label_zh: text(100),
      value: text(500),
      value_zh: text(500),
      source_url: url,
    }),
  },
  resources: {
    type: "array",
    maxItems: 12,
    items: object({
      label: text(100),
      label_zh: text(100),
      kind: {
        enum: [
          "website",
          "documentation",
          "datasheet",
          "sdk",
          "source",
          "model",
          "video",
        ],
      },
      url,
    }),
  },
  image_ids: {
    type: "array",
    maxItems: 3,
    uniqueItems: true,
    items: { type: "string", format: "uuid" },
  },
});
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://superii.site/schemas/product/v1.json",
  title: "Super ii published company product v1",
  description:
    "Company-provided information. Website control is not identity or product validation.",
  ...object({
    schema: { const: "https://superii.site/schemas/product/v1.json" },
    id: { type: "string", format: "uuid" },
    url,
    version: { type: "integer", minimum: 1 },
    company_version: { type: "integer", minimum: 1 },
    published_at: { type: "string", format: "date-time" },
    company,
    product,
    images: {
      type: "array",
      maxItems: 3,
      items: object({
        id: { type: "string", format: "uuid" },
        alt_text: text(240),
        title: text(200),
        caption: text(2000),
        image_url: url,
      }),
    },
    evidence: object({
      product_claims: { const: "company-provided" },
      website_control: {
        anyOf: [
          { type: "null" },
          object({
            hostname: text(253),
            checked_at: { type: "string", format: "date-time" },
          }),
        ],
      },
      limitation: { type: "string" },
    }),
    links: object({
      company: url,
      json: url,
      markdown: url,
      qr: url,
      sheet: url,
      mcp: url,
    }),
  }),
};
export const GET: APIRoute = async () =>
  Response.json(schema, {
    headers: {
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
