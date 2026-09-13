const publicErrors = {
  '422': { description: 'Strict input validation failed' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '503': { $ref: '#/components/responses/Unavailable' },
};

const reportKeyParameter = {
  name: 'reportKey',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
} as const;

export const transparentApiPaths = {
  '/api/transparent/check': {
    post: {
      tags: ['Transparent'],
      operationId: 'checkHuggingFaceTransparency',
      summary: 'Create or reuse an exact-revision Hugging Face evidence report',
      description: 'Accepts only a public Hugging Face model, dataset, or Space. The bounded checker resolves the requested branch, tag, or commit to an exact provider commit; reads approved metadata and small evidence files; never executes repository code or weights; and persists one immutable report for that repository, commit, and criteria version.',
      security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransparencyCheckInput' } } } },
      responses: {
        '200': { description: 'Existing permanent report reused', content: { 'application/json': { schema: { $ref: '#/components/schemas/TransparencyCheckResult' } } } },
        '201': { description: 'New permanent report created', content: { 'application/json': { schema: { $ref: '#/components/schemas/TransparencyCheckResult' } } } },
        '404': { description: 'Public repository or revision was not found or is not publicly readable' },
        '413': { description: 'Provider response, evidence file, or repository file count exceeded a checker bound' },
        '502': { description: 'Hugging Face returned invalid or boundary-violating evidence' },
        ...publicErrors,
      },
    },
  },
  '/api/transparent/reports': {
    get: {
      tags: ['Transparent'],
      operationId: 'searchTransparencyReports',
      summary: 'Search permanent public transparency reports',
      security: [],
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 } },
        { name: 'kind', in: 'query', schema: { type: 'string', enum: ['model', 'dataset', 'space'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 10000, default: 0 } },
      ],
      responses: { '200': { description: 'Real, possibly empty report result' }, ...publicErrors },
    },
  },
  '/api/transparent/reports/{reportKey}': {
    get: {
      tags: ['Transparent'],
      operationId: 'getTransparencyReport',
      summary: 'Read one immutable public report and verified creator context',
      security: [],
      parameters: [reportKeyParameter],
      responses: {
        '200': { description: 'Exact-revision report', content: { 'application/json': { schema: { type: 'object', required: ['report'], properties: { report: { $ref: '#/components/schemas/TransparencyReport' } } } } } },
        '404': { description: 'Report not found' },
        '429': { $ref: '#/components/responses/RateLimited' },
        '503': { $ref: '#/components/responses/Unavailable' },
      },
    },
  },
  '/api/transparent/compare': {
    get: {
      tags: ['Transparent'],
      operationId: 'compareTransparencyReports',
      summary: 'Compare two exact revisions of the same Hugging Face repository',
      security: [],
      parameters: [
        { name: 'left', in: 'query', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
        { name: 'right', in: 'query', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
      ],
      responses: { '200': { description: 'Field-by-field evidence state, value, source, and method changes' }, '404': { description: 'Report not found' }, ...publicErrors },
    },
  },
  '/api/transparent/reports/{reportKey}/recheck': {
    post: {
      tags: ['Transparent'],
      operationId: 'recheckTransparencyReport',
      summary: 'Check the repository current main revision and preserve a new report when changed',
      security: [],
      parameters: [reportKeyParameter],
      responses: { '200': { description: 'Current report key and whether the exact revision changed' }, '404': { description: 'Baseline report not found' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } },
    },
  },
  '/api/transparent/reports/{reportKey}/save': {
    post: {
      tags: ['Transparent'],
      operationId: 'saveTransparencyReport',
      summary: 'Add or remove a report from the signed-in member Workspace',
      security: [{ clerkSession: [] }],
      parameters: [reportKeyParameter],
      requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { saved: { type: 'boolean', default: true } }, additionalProperties: false } } } },
      responses: { '200': { description: 'Save state changed' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { description: 'Report not found' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } },
    },
  },
  '/api/transparent/reports/{reportKey}/watch': {
    post: {
      tags: ['Transparent'],
      operationId: 'watchTransparencyReport',
      summary: 'Watch or unwatch a report from the signed-in member Workspace',
      description: 'A later checked commit for the same provider repository advances the watch and creates a member notification. Agents use the separate Transparent MCP with transparent:watch scope and an idempotency key.',
      security: [{ clerkSession: [] }],
      parameters: [reportKeyParameter],
      requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { watched: { type: 'boolean', default: true } }, additionalProperties: false } } } },
      responses: { '200': { description: 'Watch state changed' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { description: 'Report not found' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } },
    },
  },
  '/api/transparent/reports/{reportKey}/claim': {
    post: {
      tags: ['Transparent'], operationId: 'claimTransparencyRepository', summary: 'Claim creator context with a matching verified Hugging Face identity',
      description: 'The current member must already have a live Hugging Face OAuth identity matching the repository owner, or a separately verified matching organization namespace. A claim never changes the immutable report.',
      security: [{ clerkSession: [] }], parameters: [reportKeyParameter],
      responses: { '200': { description: 'Verified repository claim recorded or reused' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { description: 'Matching verified owner identity is absent or another verified profile owns the claim' }, '404': { description: 'Report not found' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } },
    },
  },
  '/api/transparent/reports/{reportKey}/response': {
    post: {
      tags: ['Transparent'], operationId: 'publishTransparencyCreatorResponse', summary: 'Append a verified creator response or correction',
      description: 'Only the verified repository claimant may append context. Responses are immutable and do not rewrite the report.',
      security: [{ clerkSession: [] }], parameters: [reportKeyParameter],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransparencyCreatorResponseInput' } } } },
      responses: { '201': { description: 'Immutable creator response appended' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { description: 'Verified repository claim required' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } },
    },
  },
  '/api/transparent/reports/{reportKey}/evidence': {
    post: {
      tags: ['Transparent'], operationId: 'submitTransparencyEvidence', summary: 'Suggest a public source for one unknown field',
      description: 'Records a bounded review submission. It never fetches the submitted URL in this request and never changes the immutable report automatically.',
      security: [{ clerkSession: [] }], parameters: [reportKeyParameter],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransparencyEvidenceSubmissionInput' } } } },
      responses: { '201': { description: 'Evidence suggestion queued for review' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { description: 'Report not found' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' }, '422': { description: 'Submission failed strict validation' } },
    },
  },
} as const;

export const transparentOpenApiSchemas = {
  TransparencyCheckInput: {
    type: 'object', required: ['source'], additionalProperties: false,
    properties: {
      source: { type: 'string', minLength: 1, maxLength: 2048, description: 'Public Hugging Face repository URL or owner/repository ID.' },
      revision: { type: 'string', maxLength: 200, description: 'Optional branch, tag, or commit. Defaults to main unless present in a tree, blob, or commit URL.' },
    },
  },
  TransparencySource: {
    type: 'object', required: ['id', 'label', 'url', 'observed_at'], additionalProperties: false,
    properties: { id: { type: 'string' }, label: { type: 'string' }, url: { type: 'string', format: 'uri' }, observed_at: { type: 'string', format: 'date-time' } },
  },
  TransparencyEvidence: {
    type: 'object', required: ['id', 'label', 'state', 'summary', 'value', 'source_ids', 'method'], additionalProperties: false,
    properties: {
      id: { type: 'string' }, label: { type: 'string' },
      state: { type: 'string', enum: ['verified', 'declared', 'derived', 'unknown'] },
      summary: { type: 'string' },
      value: { type: ['string', 'number', 'array', 'null'], items: { type: 'string' } },
      source_ids: { type: 'array', items: { type: 'string' } },
      method: { type: ['string', 'null'], description: 'Present for every derived field.' },
    },
  },
  TransparencyReport: {
    type: 'object',
    required: ['schema_version', 'report_key', 'provider', 'criteria_version', 'checked_at', 'repository', 'coverage', 'evidence', 'sources', 'limitations'],
    properties: {
      schema_version: { const: '1.0' },
      report_key: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      provider: { const: 'huggingface' },
      criteria_version: { type: 'string' }, checked_at: { type: 'string', format: 'date-time' },
      repository: {
        type: 'object', required: ['kind', 'id', 'owner', 'slug', 'canonical_url', 'revision_url', 'requested_revision', 'resolved_revision', 'visibility', 'last_modified'],
        properties: {
          kind: { type: 'string', enum: ['model', 'dataset', 'space'] }, id: { type: 'string' }, owner: { type: 'string' }, slug: { type: 'string' },
          canonical_url: { type: 'string', format: 'uri' }, revision_url: { type: 'string', format: 'uri' }, requested_revision: { type: 'string' },
          resolved_revision: { type: 'string', pattern: '^[a-f0-9]{40,64}$' }, visibility: { type: 'string', enum: ['public', 'gated'] }, last_modified: { type: ['string', 'null'] },
        },
      },
      coverage: { type: 'object', required: ['total', 'established', 'unknown', 'by_state'], properties: { total: { type: 'integer' }, established: { type: 'integer' }, unknown: { type: 'integer' }, by_state: { type: 'object', required: ['verified', 'declared', 'derived', 'unknown'], properties: { verified: { type: 'integer' }, declared: { type: 'integer' }, derived: { type: 'integer' }, unknown: { type: 'integer' } } } } },
      evidence: { type: 'array', items: { $ref: '#/components/schemas/TransparencyEvidence' } },
      sources: { type: 'array', items: { $ref: '#/components/schemas/TransparencySource' } },
      limitations: { type: 'array', items: { type: 'string' } },
      community: { type: 'object', description: 'Present on stored report reads; contains a verified creator claim and immutable creator responses when they exist.' },
    },
  },
  TransparencyCheckResult: {
    type: 'object', required: ['ok', 'created', 'report_key', 'report_url', 'report'],
    properties: { ok: { const: true }, created: { type: 'boolean' }, report_key: { type: 'string', pattern: '^[a-f0-9]{64}$' }, report_url: { type: 'string', format: 'uri' }, report: { $ref: '#/components/schemas/TransparencyReport' } },
  },
  TransparencyCreatorResponseInput: {
    type: 'object', required: ['response_type', 'body'], additionalProperties: false,
    properties: { response_type: { type: 'string', enum: ['response', 'correction'] }, body: { type: 'string', minLength: 10, maxLength: 4000 }, evidence_urls: { type: 'array', maxItems: 10, default: [], items: { type: 'string', format: 'uri', pattern: '^https://' } } },
  },
  TransparencyEvidenceSubmissionInput: {
    type: 'object', required: ['criterion_id', 'note', 'source_url'], additionalProperties: false,
    properties: { criterion_id: { type: 'string', maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, note: { type: 'string', minLength: 10, maxLength: 2000 }, source_url: { type: 'string', format: 'uri', pattern: '^https://' } },
  },
} as const;
