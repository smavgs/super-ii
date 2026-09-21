import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { env } from 'cloudflare:workers';
import * as schema from './schema';

export type DatabasePurpose = 'web' | 'payment' | 'publishing';

export type DatabaseActorContext = {
  actorKind: 'public' | 'clerk' | 'agent' | 'scoped' | 'social' | 'commerce' | 'payment-webhook' | 'publishing-oidc';
  clerkUserId: string | null;
  clerkOrganizationId: string | null;
  profileId: string | null;
  organizationId: string | null;
  agentIdentityId: string | null;
  socialAgentId: string | null;
  isAdmin: boolean;
};

type ContextState = {
  purpose: DatabasePurpose;
  keyId: string;
  secret: string;
  actor: DatabaseActorContext;
  lastUsedAt: number;
};

type NeonRequestBody = {
  query?: string;
  params?: unknown[];
  queries?: Array<{ query: string; params: unknown[] }>;
};

type ContextualRequestInit = RequestInit & {
  superiiDatabaseContext?: string;
};

const sqlContexts = new WeakMap<NeonQueryFunction<false, false>, ContextState>();
const registeredContexts = new Map<string, ContextState>();
let contextualFetchInstalled = false;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function runtimeValue(_locals: App.Locals, key: string): string | undefined {
  const value = (env as Record<string, string | undefined>)[key];
  if (value) return value;
  return import.meta.env[key as keyof ImportMetaEnv];
}

function adminUserIds(locals: App.Locals): Set<string> {
  return new Set(
    (runtimeValue(locals, 'SUPERII_ADMIN_USER_IDS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function clerkContext(locals: App.Locals): DatabaseActorContext {
  let userId: string | null = null;
  let organizationId: string | null = null;
  try {
    if (typeof locals.auth === 'function') {
      const authentication = locals.auth();
      userId = 'userId' in authentication && typeof authentication.userId === 'string'
        ? authentication.userId
        : null;
      organizationId = 'orgId' in authentication && typeof authentication.orgId === 'string'
        ? authentication.orgId
        : null;
    }
  } catch {
    // Public pages are allowed to reach only public RLS policies.
  }
  return {
    actorKind: userId ? 'clerk' : 'public',
    clerkUserId: userId,
    clerkOrganizationId: organizationId,
    profileId: null,
    organizationId: null,
    agentIdentityId: null,
    socialAgentId: null,
    isAdmin: Boolean(userId && adminUserIds(locals).has(userId)),
  };
}

function purposeConfiguration(locals: App.Locals, purpose: DatabasePurpose) {
  if (purpose === 'payment') {
    return {
      url: runtimeValue(locals, 'DATABASE_PAYMENT_URL'),
      keyId: runtimeValue(locals, 'DATABASE_PAYMENT_CONTEXT_KEY_ID'),
      secret: runtimeValue(locals, 'DATABASE_PAYMENT_CONTEXT_SECRET'),
    };
  }
  if (purpose === 'publishing') {
    return {
      url: runtimeValue(locals, 'DATABASE_PUBLISHING_URL'),
      keyId: runtimeValue(locals, 'DATABASE_PUBLISHING_CONTEXT_KEY_ID'),
      secret: runtimeValue(locals, 'DATABASE_PUBLISHING_CONTEXT_SECRET'),
    };
  }
  return {
    url: runtimeValue(locals, 'DATABASE_URL'),
    keyId: runtimeValue(locals, 'DATABASE_CONTEXT_KEY_ID'),
    secret: runtimeValue(locals, 'DATABASE_CONTEXT_SECRET'),
  };
}

function safeUuid(value: string | null): string | null {
  return value && uuidPattern.test(value) ? value.toLowerCase() : null;
}

function contextPayload(
  purpose: DatabasePurpose,
  keyId: string,
  actor: DatabaseActorContext,
  expiresAt: number,
  nonce: string,
): string {
  return [
    'superii-db-context-v1',
    purpose,
    keyId,
    actor.actorKind,
    actor.clerkUserId ?? '',
    actor.clerkOrganizationId ?? '',
    safeUuid(actor.profileId) ?? '',
    safeUuid(actor.organizationId) ?? '',
    safeUuid(actor.agentIdentityId) ?? '',
    safeUuid(actor.socialAgentId) ?? '',
    actor.isAdmin ? '1' : '0',
    String(expiresAt),
    nonce,
  ].join('\n');
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function contextualFetch(state: ContextState): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body !== 'string') {
      throw new Error('database context refused a non-JSON Neon request');
    }
    let original: NeonRequestBody;
    try {
      original = JSON.parse(init.body) as NeonRequestBody;
    } catch {
      throw new Error('database context refused an invalid Neon request');
    }
    const originalBatch = Array.isArray(original.queries);
    const originalQueries = originalBatch
      ? original.queries ?? []
      : original.query
        ? [{ query: original.query, params: original.params ?? [] }]
        : [];
    if (!originalQueries.length) throw new Error('database context refused an empty Neon request');

    const expiresAt = Math.floor(Date.now() / 1000) + 30;
    const nonce = crypto.randomUUID();
    const actor = { ...state.actor };
    const signature = await hmacSha256(
      state.secret,
      contextPayload(state.purpose, state.keyId, actor, expiresAt, nonce),
    );
    const contextQuery = {
      query: `select app.begin_request_context(
        $1::text, $2::text, $3::text, $4::text, $5::text,
        $6::uuid, $7::uuid, $8::uuid, $9::uuid,
        $10::boolean, $11::bigint, $12::uuid, $13::text
      )`,
      params: [
        state.purpose,
        state.keyId,
        actor.actorKind,
        actor.clerkUserId,
        actor.clerkOrganizationId,
        safeUuid(actor.profileId),
        safeUuid(actor.organizationId),
        safeUuid(actor.agentIdentityId),
        safeUuid(actor.socialAgentId),
        actor.isAdmin,
        expiresAt,
        nonce,
        signature,
      ],
    };
    const response = await fetch(input, {
      ...init,
      body: JSON.stringify({ queries: [contextQuery, ...originalQueries] }),
    });
    if (!response.ok) return response;

    const value = await response.json() as { results?: unknown[] };
    if (!Array.isArray(value.results) || value.results.length !== originalQueries.length + 1) {
      throw new Error('database context received an invalid Neon batch response');
    }
    const output = originalBatch
      ? { results: value.results.slice(1) }
      : value.results[1];
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(output), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function installContextualFetch(): void {
  if (contextualFetchInstalled) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const contextualInit = { ...init } as ContextualRequestInit;
    const contextId = contextualInit.superiiDatabaseContext;
    if (!contextId) return nativeFetch(input, init);
    delete contextualInit.superiiDatabaseContext;

    const state = registeredContexts.get(contextId);
    if (!state) throw new Error('database context registration expired');
    state.lastUsedAt = Date.now();
    for (const [registeredId, registeredState] of registeredContexts) {
      if (registeredId !== contextId && state.lastUsedAt - registeredState.lastUsedAt > 60_000) {
        registeredContexts.delete(registeredId);
      }
    }
    if (registeredContexts.size > 2_048) {
      const oldest = [...registeredContexts.entries()]
        .filter(([registeredId]) => registeredId !== contextId)
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
        .slice(0, registeredContexts.size - 2_048);
      for (const [registeredId] of oldest) registeredContexts.delete(registeredId);
    }
    return contextualFetch(state)(input, contextualInit);
  };
  contextualFetchInstalled = true;
}

export function databaseUrl(locals: App.Locals, purpose: DatabasePurpose = 'web'): string | undefined {
  return purposeConfiguration(locals, purpose).url;
}

function contextualSqlClient(
  locals: App.Locals,
  purpose: DatabasePurpose,
  serviceActor: DatabaseActorContext | null = null,
): NeonQueryFunction<false, false> | null {
  const configuration = purposeConfiguration(locals, purpose);
  if (!configuration.url || !configuration.keyId || !configuration.secret) return null;
  if (configuration.keyId.length > 80 || configuration.secret.length < 32) return null;
  const state: ContextState = {
    purpose,
    keyId: configuration.keyId,
    secret: configuration.secret,
    actor: serviceActor ?? clerkContext(locals),
    lastUsedAt: Date.now(),
  };
  installContextualFetch();
  const contextId = crypto.randomUUID();
  registeredContexts.set(contextId, state);
  const sql = neon(configuration.url, {
    fetchOptions: { superiiDatabaseContext: contextId } as ContextualRequestInit,
  });
  sqlContexts.set(sql, state);
  return sql;
}

export function sqlClient(locals: App.Locals): NeonQueryFunction<false, false> | null {
  return contextualSqlClient(locals, 'web');
}

export function paymentSqlClient(locals: App.Locals): NeonQueryFunction<false, false> | null {
  return contextualSqlClient(locals, 'payment');
}

export function paymentWebhookSqlClient(locals: App.Locals): NeonQueryFunction<false, false> | null {
  return contextualSqlClient(locals, 'payment', {
    actorKind: 'payment-webhook',
    clerkUserId: null,
    clerkOrganizationId: null,
    profileId: null,
    organizationId: null,
    agentIdentityId: null,
    socialAgentId: null,
    isAdmin: false,
  });
}

export function publishingServiceSqlClient(locals: App.Locals): NeonQueryFunction<false, false> | null {
  return contextualSqlClient(locals, 'publishing', {
    actorKind: 'publishing-oidc',
    clerkUserId: null,
    clerkOrganizationId: null,
    profileId: null,
    organizationId: null,
    agentIdentityId: null,
    socialAgentId: null,
    isAdmin: false,
  });
}

export function setSqlActorContext(
  sql: NeonQueryFunction<false, false>,
  actor: Partial<DatabaseActorContext> & Pick<DatabaseActorContext, 'actorKind'>,
): void {
  const state = sqlContexts.get(sql);
  if (!state) throw new Error('database client is not context-bound');
  const previous = state.actor;
  state.actor = {
    actorKind: actor.actorKind,
    clerkUserId: actor.clerkUserId === undefined ? previous.clerkUserId : actor.clerkUserId,
    clerkOrganizationId: actor.clerkOrganizationId === undefined
      ? previous.clerkOrganizationId
      : actor.clerkOrganizationId,
    profileId: actor.profileId === undefined ? previous.profileId : safeUuid(actor.profileId),
    organizationId: actor.organizationId === undefined
      ? previous.organizationId
      : safeUuid(actor.organizationId),
    agentIdentityId: actor.agentIdentityId === undefined
      ? previous.agentIdentityId
      : safeUuid(actor.agentIdentityId),
    socialAgentId: actor.socialAgentId === undefined
      ? previous.socialAgentId
      : safeUuid(actor.socialAgentId),
    isAdmin: actor.isAdmin ?? previous.isAdmin,
  };
}

export function database(locals: App.Locals): NeonHttpDatabase<typeof schema> | null {
  const sql = sqlClient(locals);
  return sql ? drizzle(sql, { schema }) : null;
}

export async function pingDatabase(locals: App.Locals): Promise<'ok' | 'unconfigured' | 'error'> {
  const sql = sqlClient(locals);
  if (!sql) return 'unconfigured';

  try {
    await Promise.race([
      sql`select 1 as healthy`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
    return 'ok';
  } catch {
    return 'error';
  }
}
