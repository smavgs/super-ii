import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { connectionSecret, privateHeaders, userCode } from '@/lib/agent-connections';
import {
  DEVICE_GRANT,
  UUID,
  parseConnectionScopes,
  resourceFromUrl,
  validRedirectUri,
} from '@/lib/connection-policy';
import { sha256Hex } from '@/lib/scoped-auth';

export const ALL: APIRoute = async ({ locals, request, url, params }) => {
  const operation = params.operation;
  const headers = {
    ...privateHeaders,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['authorize', 'register', 'device', 'token'].includes(operation ?? ''))
    return reply({ error: 'not_found' }, 404);
  if (request.method !== (operation === 'authorize' ? 'GET' : 'POST'))
    return reply({ error: 'method_not_allowed' }, 405);
  const sql = sqlClient(locals);
  if (!sql) return reply({ error: 'temporarily_unavailable' }, 503);
  const rate = await consumeRateLimit(
    locals,
    request,
    sql,
    `oauth.${operation}`,
    operation === 'token' ? 720 : 60,
    3600,
  );
  if (rate !== 'allowed')
    return reply(
      { error: rate === 'limited' ? 'rate_limited' : 'temporarily_unavailable' },
      rate === 'limited' ? 429 : 503,
    );
  let input: Record<string, unknown>;
  if (operation === 'authorize') {
    if (
      url.search.length > 16_384 ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return reply({ error: 'invalid_request' }, 400);
    input = Object.fromEntries(url.searchParams);
  } else if (request.headers.get('content-type')?.includes('application/json')) {
    const parsed = await readBoundedJsonObject(request, 16_384);
    if (!parsed.ok) return reply({ error: 'invalid_request' }, 400);
    input = parsed.value;
  } else {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
      return reply({ error: 'invalid_request' }, 415);
    // Streaming bound is enforced before parsing form fields.
    const reader = request.body?.getReader();
    let body = '';
    let size = 0;
    if (!reader) return reply({ error: 'invalid_request' }, 400);
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return reply({ error: 'invalid_request' }, 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const fields = new URLSearchParams(body);
    if ([...fields.keys()].some((key) => fields.getAll(key).length !== 1))
      return reply({ error: 'invalid_request' }, 400);
    input = Object.fromEntries(fields);
  }
  try {
    if (operation === 'register') {
      const name = typeof input.client_name === 'string' ? input.client_name.trim() : 'AI agent';
      const redirects = input.redirect_uris ?? [];
      if (
        !name ||
        name.length > 120 ||
        !Array.isArray(redirects) ||
        redirects.length > 8 ||
        !redirects.every(validRedirectUri) ||
        (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none')
      )
        return reply({ error: 'invalid_client_metadata' }, 400);
      const rows =
        await sql`select app.register_agent_oauth_client(${name},${JSON.stringify(redirects)}::jsonb) as client`;
      return reply(rows[0]?.client, 201);
    }
    const client =
      typeof input.client_id === 'string' && UUID.test(input.client_id) ? input.client_id : null;
    const resource = resourceFromUrl(input.resource, url.origin);
    if (!client) return reply({ error: 'invalid_client' }, 400);
    if (!resource) return reply({ error: 'invalid_target' }, 400);
    if (operation === 'token') {
      const grant =
        input.grant_type === DEVICE_GRANT
          ? 'device_code'
          : input.grant_type === 'authorization_code'
            ? 'authorization_code'
            : null;
      if (!grant) return reply({ error: 'unsupported_grant_type' }, 400);
      const secret = grant === 'device_code' ? input.device_code : input.code;
      if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret))
        return reply({ error: 'invalid_grant' }, 400);
      const token = `sii_${resource === 'work' ? 'agent' : 'social'}_${connectionSecret()}`;
      const rows =
        await sql`select app.exchange_agent_connection(${client}::uuid,${secret},${grant},${resource},
        ${typeof input.redirect_uri === 'string' ? input.redirect_uri : null},${typeof input.code_verifier === 'string' ? input.code_verifier : null},
        ${await sha256Hex(token)},${token.slice(0, resource === 'work' ? 18 : 19)}) as result`;
      const result = rows[0]?.result;
      return result?.error
        ? reply(result, 400)
        : reply({ ...result, access_token: token, token_type: 'Bearer' });
    }
    const scope =
      input.scope ??
      (resource === 'work' ? 'repository:read receipts:read' : 'social.read social.profile.read');
    const scopes = parseConnectionScopes(scope, resource);
    if (!scopes) return reply({ error: 'invalid_scope' }, 400);
    if (operation === 'authorize') {
      if (
        input.response_type !== 'code' ||
        input.code_challenge_method !== 'S256' ||
        typeof input.code_challenge !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge) ||
        !validRedirectUri(input.redirect_uri) ||
        (input.state != null && (typeof input.state !== 'string' || input.state.length > 2048))
      )
        return reply({ error: 'invalid_request' }, 400);
      const rows =
        await sql`select app.start_agent_connection(${client}::uuid,'authorization_code',${resource},${scopes},
        ${input.redirect_uri},${input.state ?? null},${input.code_challenge},null,null) as id`;
      return new Response(null, {
        status: 303,
        headers: { ...privateHeaders, location: `/account/connect?request=${rows[0]?.id}` },
      });
    }
    const device = connectionSecret();
    const code = userCode();
    await sql`select app.start_agent_connection(${client}::uuid,'device_code',${resource},${scopes},null,null,null,${await sha256Hex(device)},${await sha256Hex(code)})`;
    const display = `${code.slice(0, 4)}-${code.slice(4)}`;
    return reply({
      device_code: device,
      user_code: display,
      verification_uri: `${url.origin}/account/connect`,
      verification_uri_complete: `${url.origin}/account/connect?code=${display}`,
      expires_in: 600,
      interval: 5,
    });
  } catch {
    return reply(
      {
        error: 'invalid_request',
        error_description:
          'The request is invalid, expired, or does not match the registered client.',
      },
      400,
    );
  }
};
