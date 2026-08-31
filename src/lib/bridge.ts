import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { runtimeValue } from './db';
import { safeRepositoryPath } from './creator';

export const BRIDGE_PROVIDER = 'huggingface';
export const BRIDGE_CLIENT_ID = 'https://superii.site/.well-known/oauth-cimd';
export const BRIDGE_REDIRECT_URI = 'https://superii.site/api/bridge/oauth/callback';
export const BRIDGE_FILE_LIMIT_BYTES = 10 * 1024 ** 3;
export const BRIDGE_REPOSITORY_LIMIT_BYTES = 20 * 1024 ** 3;
export const BRIDGE_IMPORT_LIMIT_BYTES = 25 * 1024 ** 3;
export const BRIDGE_FILE_COUNT_LIMIT = 5_000;
export const BRIDGE_DISCOVERY_LIMIT = 30;

const HF_ORIGIN = 'https://huggingface.co';
const HF_AUTHORIZE = `${HF_ORIGIN}/oauth/authorize`;
const HF_TOKEN = `${HF_ORIGIN}/oauth/token`;
const HF_USERINFO = `${HF_ORIGIN}/oauth/userinfo`;
const HF_JWKS = createRemoteJWKSet(new URL(`${HF_ORIGIN}/oauth/jwks`));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type BridgeAccess = 'public' | 'private' | 'gated' | 'organizations';
export type BridgeRepositoryKind = 'model' | 'dataset' | 'space';

export type BridgeSource = {
  provider: typeof BRIDGE_PROVIDER;
  kind: 'profile' | 'repository';
  namespace: string;
  repositoryKind?: BridgeRepositoryKind;
  repositoryId?: string;
  canonicalUrl: string;
};

export type BridgeRepositoryPreview = {
  provider_repo_id: string;
  source_revision: string;
  source_url: string;
  kind: BridgeRepositoryKind;
  title: string;
  summary: string;
  license: string | null;
  source_visibility: 'public' | 'private' | 'gated';
  file_count: number;
  total_size_bytes: number;
  largest_file_bytes: number;
  blocked_reason: string | null;
  source_metadata: Record<string, unknown>;
  source_manifest: Array<Record<string, unknown>>;
};

export type BridgeIdentity = {
  id: string;
  provider: string;
  provider_username: string;
  display_name: string | null;
  avatar_url: string | null;
  scopes: string[];
  organizations: Array<Record<string, unknown>>;
  token_expires_at: string | null;
};

type HfRepositoryPayload = Record<string, unknown> & {
  id?: unknown;
  modelId?: unknown;
  sha?: unknown;
  private?: unknown;
  gated?: unknown;
  siblings?: unknown;
  cardData?: unknown;
  tags?: unknown;
  pipeline_tag?: unknown;
  library_name?: unknown;
  sdk?: unknown;
  description?: unknown;
};

function stringValue(value: unknown, max = 2_048): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('invalid secret encoding');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomSecret(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function encryptionKey(locals: App.Locals): Promise<CryptoKey> {
  const encoded = runtimeValue(locals, 'BRIDGE_TOKEN_ENCRYPTION_KEY');
  if (!encoded) throw new Error('Bridge credential encryption is not configured');
  const raw = fromBase64Url(encoded);
  if (raw.byteLength !== 32) throw new Error('Bridge credential encryption key must contain 32 bytes');
  return crypto.subtle.importKey('raw', asArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBridgeSecret(
  locals: App.Locals,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode('superii-bridge-v1') },
    await encryptionKey(locals),
    encoder.encode(plaintext),
  );
  return { ciphertext: base64Url(new Uint8Array(encrypted)), nonce: base64Url(nonce) };
}

export async function decryptBridgeSecret(
  locals: App.Locals,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asArrayBuffer(fromBase64Url(nonce)),
      additionalData: encoder.encode('superii-bridge-v1'),
    },
    await encryptionKey(locals),
    asArrayBuffer(fromBase64Url(ciphertext)),
  );
  return decoder.decode(decrypted);
}

export function bridgeIsConfigured(locals: App.Locals): boolean {
  return Boolean(runtimeValue(locals, 'BRIDGE_TOKEN_ENCRYPTION_KEY'));
}

function safeSegment(value: string): string | null {
  const normalized = value.normalize('NFC');
  if (!normalized || normalized.length > 255 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) return null;
  return normalized;
}

export function detectBridgeSource(raw: unknown): BridgeSource | null {
  const input = stringValue(raw);
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || !['huggingface.co', 'www.huggingface.co'].includes(url.hostname.toLowerCase())
    || url.username
    || url.password
  ) return null;
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (!parts.length) return null;
  let repositoryKind: BridgeRepositoryKind = 'model';
  let offset = 0;
  if (parts[0] === 'datasets') {
    repositoryKind = 'dataset';
    offset = 1;
  } else if (parts[0] === 'spaces') {
    repositoryKind = 'space';
    offset = 1;
  } else if (['api', 'oauth', 'settings', 'docs', 'pricing', 'organizations'].includes(parts[0])) {
    return null;
  }
  const namespace = safeSegment(parts[offset] ?? '');
  if (!namespace) return null;
  const slug = safeSegment(parts[offset + 1] ?? '');
  if (!slug) {
    if (offset !== 0 || parts.length !== 1) return null;
    return {
      provider: BRIDGE_PROVIDER,
      kind: 'profile',
      namespace,
      canonicalUrl: `${HF_ORIGIN}/${encodeURIComponent(namespace)}`,
    };
  }
  return {
    provider: BRIDGE_PROVIDER,
    kind: 'repository',
    namespace,
    repositoryKind,
    repositoryId: `${namespace}/${slug}`,
    canonicalUrl: repositoryKind === 'model'
      ? `${HF_ORIGIN}/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`
      : `${HF_ORIGIN}/${repositoryKind === 'dataset' ? 'datasets' : 'spaces'}/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`,
  };
}

function scopesFor(access: BridgeAccess): string[] {
  if (access === 'private') return ['openid', 'profile', 'read-repos'];
  if (access === 'gated') return ['openid', 'profile', 'gated-repos'];
  if (access === 'organizations') return ['openid', 'profile', 'read-memberships'];
  return ['openid', 'profile'];
}

export async function beginHuggingFaceOAuth(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  access: BridgeAccess,
  returnPath = '/bring-my-work',
): Promise<string> {
  const state = randomSecret(32);
  const verifier = randomSecret(64);
  const nonce = randomSecret(32);
  const stateHash = await sha256Hex(state);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const sealed = await encryptBridgeSecret(locals, JSON.stringify({ verifier, nonce }));
  const scopes = scopesFor(access);
  const safeReturn = /^\/[a-zA-Z0-9/_?&=.-]{0,255}$/.test(returnPath) ? returnPath : '/bring-my-work';
  await sql`
    delete from app.bridge_oauth_states
    where profile_id = ${profileId}::uuid and (expires_at <= now() or consumed_at is not null)
  `;
  await sql`
    insert into app.bridge_oauth_states (
      state_hash, profile_id, provider, verifier_ciphertext, verifier_nonce,
      requested_scopes, return_path, expires_at
    ) values (
      ${stateHash}, ${profileId}::uuid, ${BRIDGE_PROVIDER}, ${sealed.ciphertext},
      ${sealed.nonce}, ${scopes}, ${safeReturn}, now() + interval '10 minutes'
    )
  `;
  const authorization = new URL(HF_AUTHORIZE);
  authorization.searchParams.set('client_id', BRIDGE_CLIENT_ID);
  authorization.searchParams.set('redirect_uri', BRIDGE_REDIRECT_URI);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('scope', scopes.join(' '));
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('nonce', nonce);
  authorization.searchParams.set('code_challenge', challenge);
  authorization.searchParams.set('code_challenge_method', 'S256');
  return authorization.toString();
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error('provider response exceeded the Bridge limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error('provider response exceeded the Bridge limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(bytes);
}

async function boundedJsonValue(response: Response, maxBytes: number): Promise<unknown> {
  const text = await boundedResponseText(response, maxBytes);
  return JSON.parse(text) as unknown;
}

async function boundedJson(response: Response, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const parsed = await boundedJsonValue(response, maxBytes);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('provider returned an invalid response');
  return parsed as Record<string, unknown>;
}

export async function completeHuggingFaceOAuth(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  code: string,
  state: string,
): Promise<{ identity: BridgeIdentity; returnPath: string }> {
  if (!code || code.length > 4_096 || !state || state.length > 512) throw new Error('OAuth callback is invalid');
  const stateHash = await sha256Hex(state);
  const stateRows = await sql`
    update app.bridge_oauth_states
    set consumed_at = now()
    where state_hash = ${stateHash}
      and profile_id = ${profileId}::uuid
      and provider = ${BRIDGE_PROVIDER}
      and consumed_at is null
      and expires_at > now()
    returning verifier_ciphertext, verifier_nonce, requested_scopes, return_path
  `;
  const stateRow = stateRows[0];
  if (!stateRow) throw new Error('OAuth state is invalid or expired');
  const sealed = JSON.parse(await decryptBridgeSecret(
    locals,
    String(stateRow.verifier_ciphertext),
    String(stateRow.verifier_nonce),
  )) as Record<string, unknown>;
  const verifier = stringValue(sealed.verifier, 512);
  const nonce = stringValue(sealed.nonce, 512);
  if (!verifier || !nonce) throw new Error('OAuth verifier is invalid');

  const tokenResponse = await fetch(HF_TOKEN, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: BRIDGE_CLIENT_ID,
      code,
      redirect_uri: BRIDGE_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error('Hugging Face authorization could not be completed');
  const token = await boundedJson(tokenResponse, 64 * 1024);
  const accessToken = stringValue(token.access_token, 8_192);
  const idToken = stringValue(token.id_token, 16_384);
  if (!accessToken || !idToken || stringValue(token.token_type, 32).toLowerCase() !== 'bearer') {
    throw new Error('Hugging Face returned an incomplete authorization');
  }
  const verified = await jwtVerify(idToken, HF_JWKS, {
    issuer: HF_ORIGIN,
    audience: BRIDGE_CLIENT_ID,
    algorithms: ['RS256'],
  });
  if (verified.payload.nonce !== nonce || typeof verified.payload.sub !== 'string') {
    throw new Error('Hugging Face identity verification failed');
  }

  const userResponse = await fetch(HF_USERINFO, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!userResponse.ok) throw new Error('Hugging Face profile could not be verified');
  const user = await boundedJson(userResponse, 128 * 1024);
  const subject = stringValue(user.sub, 255);
  const username = stringValue(user.preferred_username ?? user.username, 255);
  if (!subject || subject !== verified.payload.sub || !username) {
    throw new Error('Hugging Face identity did not match the authorization');
  }
  const rawOrganizations = Array.isArray(user.organizations) ? user.organizations : user.orgs;
  const organizations = Array.isArray(rawOrganizations)
    ? rawOrganizations.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))).slice(0, 200)
    : [];
  const scopeText = stringValue(token.scope, 2_000);
  const requestedScopes = Array.isArray(stateRow.requested_scopes)
    ? stateRow.requested_scopes.map((value) => String(value))
    : [];
  const scopes = scopeText ? scopeText.split(/\s+/).filter(Boolean) : requestedScopes;
  const expiresIn = Math.min(Math.max(Number(token.expires_in ?? 28_800), 60), 30 * 86400);
  const encrypted = await encryptBridgeSecret(locals, accessToken);
  const rows = await sql`
    insert into app.external_identities (
      profile_id, provider, provider_subject, provider_username, display_name,
      avatar_url, scopes, organizations, access_token_ciphertext,
      access_token_nonce, token_expires_at, metadata, last_verified_at, revoked_at
    ) values (
      ${profileId}::uuid, ${BRIDGE_PROVIDER}, ${subject}, ${username},
      ${stringValue(user.name, 255) || null}, ${stringValue(user.picture, 2_048) || null},
      ${scopes}, ${JSON.stringify(organizations)}::jsonb, ${encrypted.ciphertext},
      ${encrypted.nonce}, now() + (${expiresIn}::text || ' seconds')::interval,
      ${JSON.stringify({ issuer: HF_ORIGIN, token_type: 'bearer' })}::jsonb,
      now(), null
    )
    on conflict (provider, provider_subject) do update
    set provider_username = excluded.provider_username,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        scopes = excluded.scopes,
        organizations = excluded.organizations,
        access_token_ciphertext = excluded.access_token_ciphertext,
        access_token_nonce = excluded.access_token_nonce,
        token_expires_at = excluded.token_expires_at,
        metadata = excluded.metadata,
        last_verified_at = now(),
        revoked_at = null,
        updated_at = now()
    where app.external_identities.profile_id = excluded.profile_id
    returning id, provider, provider_username, display_name, avatar_url, scopes,
              organizations, token_expires_at
  `;
  if (!rows[0]) throw new Error('This Hugging Face identity is already connected to another Super ii account');
  return {
    identity: {
      id: String(rows[0].id),
      provider: String(rows[0].provider),
      provider_username: String(rows[0].provider_username),
      display_name: rows[0].display_name ? String(rows[0].display_name) : null,
      avatar_url: rows[0].avatar_url ? String(rows[0].avatar_url) : null,
      scopes: Array.isArray(rows[0].scopes) ? rows[0].scopes.map(String) : [],
      organizations: Array.isArray(rows[0].organizations) ? rows[0].organizations as Array<Record<string, unknown>> : [],
      token_expires_at: rows[0].token_expires_at ? String(rows[0].token_expires_at) : null,
    },
    returnPath: String(stateRow.return_path || '/bring-my-work'),
  };
}

export async function bridgeIdentityToken(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  identityId: string | null,
): Promise<{ token: string | null; identity: BridgeIdentity | null }> {
  if (!identityId) return { token: null, identity: null };
  const rows = await sql`
    select id, provider, provider_username, display_name, avatar_url, scopes,
           organizations, token_expires_at, access_token_ciphertext, access_token_nonce
    from app.external_identities
    where id = ${identityId}::uuid and profile_id = ${profileId}::uuid and revoked_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return { token: null, identity: null };
  const identity: BridgeIdentity = {
    id: String(row.id),
    provider: String(row.provider),
    provider_username: String(row.provider_username),
    display_name: row.display_name ? String(row.display_name) : null,
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    organizations: Array.isArray(row.organizations) ? row.organizations as Array<Record<string, unknown>> : [],
    token_expires_at: row.token_expires_at ? String(row.token_expires_at) : null,
  };
  if (
    !row.access_token_ciphertext
    || !row.access_token_nonce
    || !row.token_expires_at
    || new Date(String(row.token_expires_at)).getTime() <= Date.now() + 30_000
  ) return { token: null, identity };
  return {
    token: await decryptBridgeSecret(locals, String(row.access_token_ciphertext), String(row.access_token_nonce)),
    identity,
  };
}

function hfApiPath(kind: BridgeRepositoryKind, repositoryId: string): string {
  const encoded = repositoryId.split('/').map(encodeURIComponent).join('/');
  if (kind === 'dataset') return `/api/datasets/${encoded}`;
  if (kind === 'space') return `/api/spaces/${encoded}`;
  return `/api/models/${encoded}`;
}

async function hfFetchJson(path: string, token: string | null, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const target = new URL(path, HF_ORIGIN);
  if (target.origin !== HF_ORIGIN || !target.pathname.startsWith('/api/')) throw new Error('invalid provider request');
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Superii-Bridge/1.0' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(target, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('provider_authorization_required');
  if (response.status === 404) throw new Error('provider_repository_not_found');
  if (response.status === 429) throw new Error('provider_rate_limited');
  if (!response.ok) throw new Error('provider_unavailable');
  try {
    return await boundedJsonValue(response, maxBytes);
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeded')) throw new Error('provider_response_too_large');
    throw new Error('provider_response_invalid');
  }
}

function cardRecord(payload: HfRepositoryPayload): Record<string, unknown> {
  return payload.cardData && typeof payload.cardData === 'object' && !Array.isArray(payload.cardData)
    ? payload.cardData as Record<string, unknown>
    : {};
}

function repositoryLicense(payload: HfRepositoryPayload): string | null {
  const card = cardRecord(payload);
  const fromCard = stringValue(card.license, 120);
  if (fromCard) return fromCard;
  const tag = Array.isArray(payload.tags)
    ? payload.tags.map((value) => stringValue(value, 200)).find((value) => value.startsWith('license:'))
    : undefined;
  return tag ? tag.slice('license:'.length, 120 + 'license:'.length) : null;
}

function providerSecurityStatus(payload: HfRepositoryPayload): string | null {
  const raw = payload.securityStatus ?? payload.security_repo_status;
  if (typeof raw === 'string') return stringValue(raw, 120) || null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const status = raw as Record<string, unknown>;
  return stringValue(status.status ?? status.state ?? status.result, 120) || null;
}

export async function inspectHuggingFaceRepository(
  source: BridgeSource,
  token: string | null,
  grantedScopes: string[] = [],
): Promise<BridgeRepositoryPreview> {
  if (source.kind !== 'repository' || !source.repositoryId || !source.repositoryKind) {
    throw new Error('repository source is required');
  }
  const raw = await hfFetchJson(`${hfApiPath(source.repositoryKind, source.repositoryId)}?blobs=true`, token);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('provider_repository_invalid');
  const payload = raw as HfRepositoryPayload;
  const providerRepoId = stringValue(payload.id ?? payload.modelId, 511);
  const sourceRevision = stringValue(payload.sha, 64).toLowerCase();
  if (providerRepoId.toLowerCase() !== source.repositoryId.toLowerCase() || !/^[a-f0-9]{40,64}$/.test(sourceRevision)) {
    throw new Error('provider_revision_invalid');
  }
  const siblings = Array.isArray(payload.siblings) ? payload.siblings : [];
  const manifest: Array<Record<string, unknown>> = [];
  let totalSize = 0;
  let largestFile = 0;
  let metadataIncomplete = false;
  for (const rawSibling of siblings.slice(0, BRIDGE_FILE_COUNT_LIMIT + 1)) {
    if (!rawSibling || typeof rawSibling !== 'object' || Array.isArray(rawSibling)) {
      metadataIncomplete = true;
      continue;
    }
    const sibling = rawSibling as Record<string, unknown>;
    const path = safeRepositoryPath(sibling.rfilename);
    const size = Number(sibling.size);
    if (!path || !Number.isSafeInteger(size) || size < 0) {
      metadataIncomplete = true;
      continue;
    }
    totalSize += size;
    largestFile = Math.max(largestFile, size);
    const lfs = sibling.lfs && typeof sibling.lfs === 'object' && !Array.isArray(sibling.lfs)
      ? sibling.lfs as Record<string, unknown>
      : null;
    manifest.push({
      path,
      size_bytes: size,
      source_oid: stringValue(sibling.blobId ?? sibling.blob_id, 128) || null,
      source_sha256: lfs ? stringValue(lfs.sha256, 64) || null : null,
    });
  }
  const isPrivate = payload.private === true;
  const isGated = payload.gated === true || typeof payload.gated === 'string';
  const visibility = isPrivate ? 'private' : isGated ? 'gated' : 'public';
  const license = repositoryLicense(payload);
  const sdk = stringValue(payload.sdk ?? cardRecord(payload).sdk, 120).toLowerCase();
  let blockedReason: string | null = null;
  if (siblings.length > BRIDGE_FILE_COUNT_LIMIT) blockedReason = 'too_many_files';
  else if (!siblings.length) blockedReason = 'empty_repository';
  else if (metadataIncomplete || manifest.length !== siblings.length) blockedReason = 'metadata_incomplete';
  else if (totalSize < 1) blockedReason = 'empty_repository';
  else if (largestFile > BRIDGE_FILE_LIMIT_BYTES) blockedReason = 'file_over_10_gib';
  else if (totalSize > BRIDGE_REPOSITORY_LIMIT_BYTES) blockedReason = 'repository_over_20_gib';
  else if (isPrivate && !grantedScopes.includes('read-repos')) blockedReason = 'private_authorization_required';
  else if (isGated && !grantedScopes.includes('gated-repos')) blockedReason = 'gated_authorization_required';
  else if (!license) blockedReason = 'license_review_required';
  else if (source.repositoryKind === 'space' && sdk && sdk !== 'gradio') blockedReason = 'space_runtime_unsupported';

  const slug = source.repositoryId.split('/')[1] ?? source.repositoryId;
  const summary = stringValue(payload.description ?? cardRecord(payload).description, 2_000);
  return {
    provider_repo_id: providerRepoId,
    source_revision: sourceRevision,
    source_url: source.canonicalUrl,
    kind: source.repositoryKind,
    title: stringValue(cardRecord(payload).title, 200) || slug,
    summary,
    license,
    source_visibility: visibility,
    file_count: manifest.length,
    total_size_bytes: totalSize,
    largest_file_bytes: largestFile,
    blocked_reason: blockedReason,
    source_metadata: {
      task: stringValue(payload.pipeline_tag, 120) || null,
      library: stringValue(payload.library_name, 120) || null,
      sdk: sdk || null,
      provider_security_status: providerSecurityStatus(payload),
    },
    source_manifest: manifest,
  };
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function discoverHuggingFaceRepositories(
  source: BridgeSource,
  token: string | null,
  grantedScopes: string[] = [],
): Promise<BridgeRepositoryPreview[]> {
  if (source.kind === 'repository') {
    return [await inspectHuggingFaceRepository(source, token, grantedScopes)];
  }
  const candidates: BridgeSource[] = [];
  for (const kind of ['model', 'dataset', 'space'] as const) {
    const plural = kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
    const raw = await hfFetchJson(`/api/${plural}?author=${encodeURIComponent(source.namespace)}&limit=${BRIDGE_DISCOVERY_LIMIT}&full=true`, token);
    if (!Array.isArray(raw)) throw new Error('provider_listing_invalid');
    for (const value of raw) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const payload = value as Record<string, unknown>;
      const id = stringValue(payload.id ?? payload.modelId, 511);
      const [namespace, slug, extra] = id.split('/');
      if (extra || namespace?.toLowerCase() !== source.namespace.toLowerCase() || !safeSegment(slug ?? '')) continue;
      candidates.push({
        provider: BRIDGE_PROVIDER,
        kind: 'repository',
        namespace,
        repositoryKind: kind,
        repositoryId: `${namespace}/${slug}`,
        canonicalUrl: kind === 'model'
          ? `${HF_ORIGIN}/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`
          : `${HF_ORIGIN}/${kind === 'dataset' ? 'datasets' : 'spaces'}/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`,
      });
      if (candidates.length >= BRIDGE_DISCOVERY_LIMIT) break;
    }
    if (candidates.length >= BRIDGE_DISCOVERY_LIMIT) break;
  }
  return mapConcurrent(candidates, 4, async (candidate) => {
    try {
      return await inspectHuggingFaceRepository(candidate, token, grantedScopes);
    } catch (error) {
      const repositoryId = candidate.repositoryId ?? 'unknown/unknown';
      return {
        provider_repo_id: repositoryId,
        source_revision: '0'.repeat(40),
        source_url: candidate.canonicalUrl,
        kind: candidate.repositoryKind ?? 'model',
        title: repositoryId.split('/')[1] ?? repositoryId,
        summary: '',
        license: null,
        source_visibility: 'public',
        file_count: 0,
        total_size_bytes: 0,
        largest_file_bytes: 0,
        blocked_reason: error instanceof Error ? error.message.slice(0, 120) : 'provider_repository_invalid',
        source_metadata: {},
        source_manifest: [],
      } satisfies BridgeRepositoryPreview;
    }
  });
}
