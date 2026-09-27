const cardTokenParameter = {
  name: 'token',
  in: 'path',
  required: true,
  description: 'The 256-bit unlisted card token. Treat it as bearer-like access and never place it in analytics or application logs.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
} as const;

const publicCardResponses = {
  '404': { description: 'The card does not exist, is paused, was deleted, or its link was rotated' },
  '503': { $ref: '#/components/responses/Unavailable' },
} as const;

export const cardApiPaths = {
  '/c/{token}/card.json': {
    get: {
      tags: ['Cards'],
      operationId: 'getPublicCardDocument',
      summary: 'Read the selected public snapshot for one active unlisted card',
      description: 'Returns only fields the owner published. The token is bearer-like unlisted access, not authentication. Responses are not cached and request indexing is disabled.',
      security: [],
      parameters: [cardTokenParameter],
      responses: {
        '200': { description: 'Versioned public card document', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicCardDocument' } } } },
        ...publicCardResponses,
      },
    },
  },
  '/c/{token}/contact.vcf': {
    get: {
      tags: ['Cards'],
      operationId: 'downloadPublicCardVcard',
      summary: 'Download the selected contact fields as a vCard 4.0 file',
      security: [],
      parameters: [
        cardTokenParameter,
        { name: 'language', in: 'query', required: false, schema: { type: 'string', enum: ['en', 'zh-CN'], default: 'en' } },
      ],
      responses: {
        '200': { description: 'Contact file generated from the current published snapshot', content: { 'text/vcard': { schema: { type: 'string' } } } },
        ...publicCardResponses,
      },
    },
  },
  '/c/{token}/qr.svg': {
    get: {
      tags: ['Cards'],
      operationId: 'getPublicCardQr',
      summary: 'Render a standards-based QR code for the unlisted card link',
      security: [],
      parameters: [cardTokenParameter],
      responses: {
        '200': { description: 'High-error-correction SVG QR code', content: { 'image/svg+xml': { schema: { type: 'string' } } } },
        ...publicCardResponses,
      },
    },
  },
  '/api/cards/public/{token}/connections': {
    post: {
      tags: ['Cards'],
      operationId: 'shareContactBackToCardOwner',
      summary: 'Privately share contact details back to an active card owner',
      description: 'Browser-only same-origin action. The payload is validated, rate limited, encrypted before database storage, and never added to a public directory. The card owner must have enabled share-back.',
      security: [],
      parameters: [cardTokenParameter],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CardShareBackInput' } } },
      },
      responses: {
        '201': { description: 'Encrypted connection stored', content: { 'application/json': { schema: { type: 'object', required: ['ok'], properties: { ok: { const: true } }, additionalProperties: false } } } },
        '403': { description: 'Request origin is not the canonical Super ii site' },
        '404': publicCardResponses['404'],
        '409': { description: 'The connection could not be accepted' },
        '422': { description: 'A name and a valid email or phone number are required' },
        '429': { $ref: '#/components/responses/RateLimited' },
        '503': publicCardResponses['503'],
      },
    },
  },
} as const;

export const localizedCardIdentitySchema = {
  type: 'object',
  required: ['name', 'role', 'organization', 'tagline', 'bio'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    role: { type: 'string', maxLength: 120 },
    organization: { type: 'string', maxLength: 120 },
    tagline: { type: 'string', maxLength: 180 },
    bio: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
} as const;

export const publicCardSnapshotSchema = {
  type: 'object',
  required: [
    'version', 'card_id', 'preset', 'name', 'identity_en', 'identity_zh',
    'photo_url', 'location', 'services', 'verified_badges', 'personal_badges',
    'default_locale', 'allow_share_back', 'published_at',
  ],
  properties: {
    version: { const: 1 },
    card_id: { type: 'string', format: 'uuid' },
    preset: { type: 'string', enum: ['superii', 'business', 'personal', 'conference', 'investor', 'open_source', 'custom'] },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    identity_en: localizedCardIdentitySchema,
    identity_zh: { anyOf: [localizedCardIdentitySchema, { type: 'null' }] },
    photo_url: { type: ['string', 'null'], format: 'uri' },
    location: { type: ['string', 'null'], maxLength: 120 },
    services: {
      type: 'array',
      maxItems: 17,
      items: {
        type: 'object',
        required: ['id', 'label', 'value', 'href'],
        properties: {
          id: { type: 'string', enum: ['email', 'phone', 'website', 'wechat', 'whatsapp', 'telegram', 'linkedin', 'github', 'huggingface', 'qq', 'red', 'weibo', 'custom'] },
          label: { type: 'string', minLength: 1, maxLength: 40 },
          value: { type: 'string', minLength: 1, maxLength: 2048 },
          href: { type: ['string', 'null'], maxLength: 2048 },
        },
        additionalProperties: false,
      },
    },
    verified_badges: {
      type: 'array', maxItems: 7, uniqueItems: true,
      items: { type: 'string', enum: ['founding_200', 'community_leader', 'publisher', 'agent_builder', 'robot_builder', 'transparency_contributor', 'open_source_builder'] },
    },
    personal_badges: {
      type: 'array', maxItems: 4, uniqueItems: true,
      items: { type: 'string', enum: ['ai_research', 'open_source', 'community', 'robotics', 'agents', 'builder', 'investor', 'founder'] },
    },
    default_locale: { type: 'string', enum: ['en', 'zh-CN'] },
    allow_share_back: { type: 'boolean' },
    published_at: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const;

export const publicCardDocumentSchema = {
  type: 'object',
  required: ['schema', 'revision', 'card'],
  properties: {
    schema: { const: 'https://superii.site/schemas/card/v1.json' },
    revision: { type: 'integer', minimum: 1 },
    card: publicCardSnapshotSchema,
  },
  additionalProperties: false,
} as const;

export const cardOpenApiSchemas = {
  PublicCardDocument: publicCardDocumentSchema,
  PublicCardSnapshot: publicCardSnapshotSchema,
  CardShareBackInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', format: 'email', maxLength: 254 },
      phone: { type: 'string', maxLength: 40 },
      message: { type: 'string', maxLength: 1000 },
    },
    anyOf: [
      { required: ['email'], properties: { email: { type: 'string', format: 'email', minLength: 3, maxLength: 254 } } },
      { required: ['phone'], properties: { phone: { type: 'string', minLength: 1, maxLength: 40 } } },
    ],
    additionalProperties: false,
  },
} as const;
