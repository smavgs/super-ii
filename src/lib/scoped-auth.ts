import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ensureAuthenticatedProfile, sameOrigin } from './auth';

export const repositoryScopes = [
  'repository:upload',
  'repository:commit',
  'repository:submit',
  'repository:trace',
] as const;

export type RepositoryScope = (typeof repositoryScopes)[number];

export type RepositoryActor = {
  kind: 'profile' | 'scoped-token';
  profileId: string;
  createdBy: string;
  tokenId: string | null;
  trustedPublisherId: string | null;
  serviceAccountId: string | null;
};

export type RepositoryAuthorization =
  | { ok: true; actor: RepositoryActor }
  | { ok: false; status: 401 | 403 | 503; error: string };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return /^sii_[a-z0-9]{40,128}$/.test(token) ? token : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function authorizeRepositoryRequest(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  repositoryId: string,
  scope: RepositoryScope,
): Promise<RepositoryAuthorization> {
  const authorizationHeader = request.headers.get('authorization');
  const token = bearerToken(request);
  if (authorizationHeader && !token) {
    return { ok: false, status: 401, error: 'invalid scoped access token' };
  }

  if (token) {
    const tokenHash = await sha256Hex(token);
    try {
      const rows = await sql`
        with eligible as (
          select
            access_token.id,
            access_token.created_by_profile_id,
            access_token.trusted_publisher_id,
            access_token.service_account_id
          from app.scoped_access_tokens access_token
          left join app.trusted_publishers publisher
            on publisher.id = access_token.trusted_publisher_id
          left join app.service_accounts service_account
            on service_account.id = access_token.service_account_id
          where access_token.token_hash = ${tokenHash}
            and access_token.repository_id = ${repositoryId}::uuid
            and access_token.revoked_at is null
            and access_token.expires_at > now()
            and access_token.scopes ? ${scope}
            and (
              (publisher.id is not null and publisher.enabled)
              or (service_account.id is not null and service_account.disabled_at is null)
            )
          for update of access_token
        ), touched as (
          update app.scoped_access_tokens access_token
          set last_used_at = now()
          from eligible
          where access_token.id = eligible.id
          returning eligible.*
        )
        select * from touched
      `;
      const row = rows[0];
      if (!row?.id) return { ok: false, status: 403, error: 'token is expired, revoked, out of scope, or repository-bound elsewhere' };
      if (row.trusted_publisher_id) {
        await sql`
          update app.trusted_publishers
          set last_used_at = now()
          where id = ${String(row.trusted_publisher_id)}::uuid
        `;
      }
      return {
        ok: true,
        actor: {
          kind: 'scoped-token',
          profileId: String(row.created_by_profile_id),
          createdBy: row.trusted_publisher_id
            ? `trusted-publisher:${String(row.trusted_publisher_id)}`
            : `service-account:${String(row.service_account_id)}`,
          tokenId: String(row.id),
          trustedPublisherId: row.trusted_publisher_id ? String(row.trusted_publisher_id) : null,
          serviceAccountId: row.service_account_id ? String(row.service_account_id) : null,
        },
      };
    } catch {
      return { ok: false, status: 503, error: 'scoped authorization service unavailable' };
    }
  }

  if (!sameOrigin(request)) return { ok: false, status: 403, error: 'invalid origin' };
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return { ok: false, status: 401, error: 'authentication required' };
  return {
    ok: true,
    actor: {
      kind: 'profile',
      profileId: profile.profileId,
      createdBy: profile.profileId,
      tokenId: null,
      trustedPublisherId: null,
      serviceAccountId: null,
    },
  };
}
