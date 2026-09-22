const modelParameters = [
  { name: 'owner', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 120 } },
  { name: 'slug', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 96 } },
  { name: 'revision', in: 'query', required: false, description: 'Published model revision UUID. Omit for the current published revision.', schema: { type: 'string', format: 'uuid' } },
];

const responses = {
  '404': { description: 'Published public model not found' },
  '422': { description: 'Input is invalid or the model has no verified text tokenizer' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '503': { $ref: '#/components/responses/Unavailable' },
};

export const tokenizerApiPaths = {
  '/api/tokenizers/{owner}/{slug}/manifest': {
    get: {
      tags: ['Tokenizer'],
      operationId: 'getVerifiedTokenizerManifest',
      summary: 'Read the immutable verified tokenizer pack for a published model',
      description: 'Returns the engine, safe portable artifacts, context length, content hash and plain, multilingual and emoji reference vectors. No repository code executes.',
      security: [],
      parameters: modelParameters,
      responses: {
        '200': { description: 'Content-addressed verified tokenizer manifest', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenizerManifest' } } } },
        ...responses,
      },
    },
  },
  '/api/tokenizers/{owner}/{slug}/encode': {
    post: {
      tags: ['Tokenizer'],
      operationId: 'encodeModelText',
      summary: 'Encode text with the model exact verified tokenizer',
      description: 'Returns token IDs, token text, decoded pieces, special-token flags, character and UTF-8 byte offsets, context use, immutable revision and pack hash.',
      security: [],
      parameters: modelParameters,
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['text'],
        properties: {
          text: { type: 'string', maxLength: 100000 },
          add_special_tokens: { type: 'boolean', default: true },
        },
      } } } },
      responses: {
        '200': { description: 'Verified exact-token result', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenizerEncodeResult' } } } },
        ...responses,
      },
    },
  },
  '/api/tokenizers/{owner}/{slug}/decode': {
    post: {
      tags: ['Tokenizer'],
      operationId: 'decodeModelTokenIds',
      summary: 'Decode IDs with the model exact verified tokenizer',
      security: [],
      parameters: modelParameters,
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['token_ids'],
        properties: {
          token_ids: { type: 'array', minItems: 1, maxItems: 100000, items: { type: 'integer', minimum: 0, maximum: 2147483647 } },
          skip_special_tokens: { type: 'boolean', default: false },
        },
      } } } },
      responses: {
        '200': { description: 'Verified decoded text', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenizerDecodeResult' } } } },
        ...responses,
      },
    },
  },
  '/api/tokenizers/{owner}/{slug}/revisions/{revision}/pack/{path}': {
    get: {
      tags: ['Tokenizer'],
      operationId: 'downloadVerifiedTokenizerArtifact',
      summary: 'Download one content-verified tokenizer-pack artifact',
      description: 'The published revision is part of the path. Artifact bytes are checked against the immutable manifest before delivery.',
      security: [],
      parameters: [
        modelParameters[0],
        modelParameters[1],
        { name: 'revision', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'path', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 1024 } },
      ],
      responses: {
        '200': { description: 'Immutable tokenizer artifact bytes' },
        '404': { description: 'Published model revision or artifact not found' },
        '422': responses['422'],
        '503': responses['503'],
      },
    },
  },
} as const;

const proof = {
  type: 'object',
  required: ['pack_sha256', 'source_revision_id', 'engine', 'engine_version'],
  properties: {
    pack_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    source_revision_id: { type: 'string', format: 'uuid' },
    engine: { type: 'string' },
    engine_version: { type: 'string' },
    model_commit_sha: { type: ['string', 'null'] },
  },
} as const;

export const tokenizerOpenApiSchemas = {
  TokenizerManifest: {
    ...proof,
    required: [...proof.required, 'version', 'artifact_url_template', 'artifacts', 'verification_vectors'],
    properties: {
      ...proof.properties,
      version: { const: 'superii-tokenizer-pack-v1' },
      tokenizer_class: { type: 'string' },
      vocabulary_size: { type: ['integer', 'null'] },
      context_length: { type: ['integer', 'null'] },
      browser_compatible: { type: 'boolean' },
      artifact_url_template: { type: 'string' },
      artifacts: { type: 'array', items: { type: 'object' } },
      verification_vectors: { type: 'array', minItems: 3, items: { type: 'object' } },
    },
  },
  TokenizerEncodeResult: {
    type: 'object',
    required: ['verified', 'pack_sha256', 'revision_id', 'token_ids', 'pieces', 'token_count'],
    properties: {
      verified: { const: true },
      pack_sha256: proof.properties.pack_sha256,
      revision_id: { type: 'string', format: 'uuid' },
      token_ids: { type: 'array', items: { type: 'integer' } },
      pieces: { type: 'array', items: { type: 'object' } },
      token_count: { type: 'integer', minimum: 0 },
      context_length: { type: ['integer', 'null'] },
      decoded: { type: 'string' },
      engine: { type: 'string' },
    },
  },
  TokenizerDecodeResult: {
    type: 'object',
    required: ['verified', 'pack_sha256', 'revision_id', 'token_ids', 'token_count', 'text'],
    properties: {
      verified: { const: true },
      pack_sha256: proof.properties.pack_sha256,
      revision_id: { type: 'string', format: 'uuid' },
      token_ids: { type: 'array', items: { type: 'integer' } },
      token_count: { type: 'integer', minimum: 1 },
      text: { type: 'string' },
      text_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      engine: { type: 'string' },
    },
  },
} as const;
