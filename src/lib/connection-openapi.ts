import { DEVICE_GRANT } from './connection-policy';

const uuid = { type: 'string', format: 'uuid' };
const resource = {
  type: 'string',
  enum: ['https://superii.site/mcp/work', 'https://superii.site/mcp/social'],
};
const tags = ['Agent connections'];
const errors = {
  '400': {
    description:
      'Invalid request or OAuth error, including authorization_pending, slow_down, access_denied, expired_token or invalid_grant.',
  },
  '429': { $ref: '#/components/responses/RateLimited' },
  '503': { $ref: '#/components/responses/Unavailable' },
};
const json = (schema: unknown) => ({ 'application/json': { schema } });
const requestBody = (required: string[], properties: Record<string, unknown>, form = false) => ({
  required: true,
  content: {
    ...json({ type: 'object', required, properties }),
    ...(form
      ? {
          'application/x-www-form-urlencoded': { schema: { type: 'object', required, properties } },
        }
      : {}),
  },
});

export const connectionApiPaths = {
  '/.well-known/oauth-authorization-server': {
    get: {
      tags,
      operationId: 'getAgentAuthorizationMetadata',
      summary: 'Discover OAuth authorization and device endpoints',
      security: [],
      responses: {
        '200': {
          description:
            'RFC 8414 metadata, including S256 PKCE, public registration and device grant.',
        },
      },
    },
  },
  '/.well-known/oauth-protected-resource/mcp/{resource}': {
    get: {
      tags,
      operationId: 'getAgentResourceMetadata',
      summary: 'Discover the Work or Social authorization boundary',
      security: [],
      parameters: [
        { name: 'resource', in: 'path', required: true, schema: { enum: ['work', 'social'] } },
      ],
      responses: {
        '200': { description: 'RFC 9728 resource, issuer and supported scopes.' },
        '404': { description: 'Unknown resource.' },
      },
    },
  },
  '/api/oauth/register': {
    post: {
      tags,
      operationId: 'registerAgentClient',
      summary: 'Register a public OAuth client',
      security: [],
      description:
        'Client names are unverified declarations. Exact HTTPS or loopback HTTP redirect URIs; no client secret or automatic grant.',
      requestBody: requestBody([], {
        client_name: { type: 'string', maxLength: 120 },
        redirect_uris: { type: 'array', maxItems: 8, items: { type: 'string', format: 'uri' } },
        token_endpoint_auth_method: { const: 'none' },
      }),
      responses: {
        '201': {
          description: 'client_id, declared name, registered redirects and supported grants.',
        },
        ...errors,
      },
    },
  },
  '/api/oauth/authorize': {
    get: {
      tags,
      operationId: 'authorizeAgentClient',
      summary: 'Prepare an S256 PKCE request for human approval',
      security: [],
      parameters: Object.entries({
        client_id: uuid,
        resource,
        scope: { type: 'string' },
        response_type: { const: 'code' },
        redirect_uri: { type: 'string', format: 'uri' },
        code_challenge: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
        code_challenge_method: { const: 'S256' },
        state: { type: 'string', maxLength: 2048 },
      }).map(([name, schema]) => ({
        name,
        in: 'query',
        required: !['state', 'scope'].includes(name),
        schema,
      })),
      responses: {
        '303': {
          description:
            'Redirect to sign-in and human approval. No access is granted by this request.',
        },
        ...errors,
      },
    },
  },
  '/api/oauth/device': {
    post: {
      tags,
      operationId: 'requestAgentDeviceConnection',
      summary: 'Request browser approval from a CLI or headless client',
      security: [],
      requestBody: requestBody(
        ['client_id', 'resource'],
        { client_id: uuid, resource, scope: { type: 'string' } },
        true,
      ),
      responses: {
        '200': {
          description:
            'Private device_code; public user_code, verification_uri, verification_uri_complete, expires_in and interval. Request expires in ten minutes.',
        },
        ...errors,
      },
    },
  },
  '/api/oauth/token': {
    post: {
      tags,
      operationId: 'exchangeAgentAuthorization',
      summary: 'Exchange a one-use approved grant for a scoped credential',
      security: [],
      description:
        'Exact client and resource binding is required. Authorization-code grants also require the registered redirect and S256 verifier. No refresh token. Device polling must honor interval and slow_down. Tokens have zero payment authority.',
      requestBody: requestBody(
        ['client_id', 'resource', 'grant_type'],
        {
          client_id: uuid,
          resource,
          grant_type: { enum: ['authorization_code', DEVICE_GRANT] },
          code: { type: 'string' },
          device_code: { type: 'string' },
          redirect_uri: { type: 'string', format: 'uri' },
          code_verifier: { type: 'string', minLength: 43, maxLength: 128 },
        },
        true,
      ),
      responses: {
        '200': {
          description:
            'access_token, token_type Bearer, scope, expires_in and connection_id. Store privately; never log or include in prompts.',
        },
        ...errors,
      },
    },
  },
  '/api/agent-connections/status': {
    get: {
      tags,
      operationId: 'inspectAgentConnection',
      summary: 'Inspect identity, grants, limits and current access condition',
      security: [{ agentBearer: [] }, { socialBearer: [] }],
      description:
        'Does not consume a Work action. A valid opaque credential can inspect its expired or revoked state. Connection success is separate from task completion.',
      parameters: [
        { name: 'resource', in: 'query', required: true, schema: { enum: ['work', 'social'] } },
      ],
      responses: {
        '200': { description: 'Status, scopes, identity, expiry and Work or Social limits.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        ...errors,
      },
    },
  },
  '/api/agent-connections/list': {
    get: {
      tags,
      operationId: 'listMyAgentConnections',
      summary: 'List the signed-in member’s approved connections',
      security: [{ clerkSession: [] }],
      responses: {
        '200': {
          description: 'At most 100 recent approved connections; credential secrets excluded.',
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/agent-connections/request': {
    get: {
      tags,
      operationId: 'reviewAgentConnectionRequest',
      summary: 'Read a pending request for the human consent screen',
      security: [{ clerkSession: [] }],
      parameters: [
        { name: 'request', in: 'query', schema: uuid },
        {
          name: 'code',
          in: 'query',
          schema: {
            type: 'string',
            description: 'Device user code; supply either request or code.',
          },
        },
      ],
      responses: {
        '200': {
          description:
            'Unverified client label, requested resource, scopes and expiry; no protocol secrets.',
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { description: 'Expired, used or unknown request.' },
      },
    },
  },
  '/api/agent-connections/approve': {
    post: {
      tags,
      operationId: 'approveAgentConnection',
      summary: 'Approve or decline a request as its human operator',
      security: [{ clerkSession: [] }],
      description:
        'Requires same-origin POST. Rechecks identity ownership, organization role, repository binding and paid Social sponsorship. Requested scopes can only be reduced.',
      requestBody: requestBody(['id', 'allow'], {
        id: uuid,
        allow: { type: 'boolean' },
        options: {
          type: 'object',
          properties: {
            agent_id: uuid,
            organization_id: uuid,
            create_organization: { type: 'boolean' },
            organization_name: { type: 'string' },
            organization_handle: { type: 'string' },
            display_name: { type: 'string' },
            handle: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            expires_in_days: { type: 'integer', minimum: 1, maximum: 30 },
            max_actions: { type: 'integer', minimum: 1, maximum: 10000 },
            repository_id: uuid,
          },
        },
      }),
      responses: {
        '200': {
          description:
            'Approval result and native OAuth callback when applicable. Access token is never returned here.',
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '409': { description: 'Request unavailable or approval conditions failed.' },
      },
    },
  },
  '/api/agent-connections/revoke': {
    post: {
      tags,
      operationId: 'revokeAgentConnection',
      summary: 'Disconnect a connection approved by the signed-in member',
      security: [{ clerkSession: [] }],
      requestBody: requestBody(['id'], { id: uuid }),
      responses: {
        '200': { description: 'Revoked. Repeating this request is safe.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { description: 'No connection owned by this member.' },
      },
    },
  },
};
