const parameter = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
});
const responses = {
  "200": {
    description: "Published company-provided product data; not certification",
  },
  "404": { description: "Not published, paused or unavailable" },
  "429": { description: "Rate limit exceeded" },
  "503": { description: "Product service unavailable" },
};
export const productApiPaths = {
  "/api/products": {
    get: {
      operationId: "searchCompanyProducts",
      tags: ["Products"],
      summary: "Search published company products",
      security: [],
      parameters: [
        { name: "q", in: "query", schema: { type: "string", maxLength: 120 } },
        {
          name: "kind",
          in: "query",
          schema: {
            type: "string",
            enum: ["model", "robot", "component", "hardware"],
          },
        },
        { name: "owner", in: "query", schema: { type: "string" } },
        {
          name: "offset",
          in: "query",
          schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
        },
      ],
      responses,
    },
  },
  "/api/products/{owner}/{slug}": {
    get: {
      operationId: "getCompanyProduct",
      tags: ["Products"],
      summary: "Read a published product and company snapshot",
      description:
        "Includes separate company and product versions, company-provided evidence limits, and published contact methods. A paused or rotated representative Card is omitted.",
      security: [],
      parameters: [parameter("owner"), parameter("slug")],
      responses,
    },
  },
  "/api/products/{owner}/{slug}/answer": {
    get: {
      operationId: "findProductEvidence",
      tags: ["Products"],
      summary: "Retrieve matching published fields with sources",
      description:
        "Deterministic field retrieval, not a generated answer or product validation. Returns found or not_documented.",
      security: [],
      parameters: [
        parameter("owner"),
        parameter("slug"),
        {
          name: "question",
          in: "query",
          required: true,
          schema: { type: "string", minLength: 1, maxLength: 500 },
        },
        {
          name: "locale",
          in: "query",
          schema: {
            type: "string",
            enum: ["en", "zh-CN", "ru"],
            default: "en",
          },
        },
      ],
      responses,
    },
  },
  "/products/{owner}/{slug}/product.json": {
    get: {
      operationId: "getProductRepresentation",
      tags: ["Products"],
      summary: "Read the published product JSON representation",
      security: [],
      parameters: [parameter("owner"), parameter("slug")],
      responses,
    },
  },
  "/products/{owner}/{slug}/product.md": {
    get: {
      operationId: "getProductMarkdown",
      tags: ["Products"],
      summary: "Read product facts as Markdown",
      security: [],
      parameters: [parameter("owner"), parameter("slug")],
      responses,
    },
  },
};
