# Super ii Bridge security and transfer contract

Super ii Bridge is the provider-neutral system behind the user-facing **Bring
my work** flow. Hugging Face is the first connector. OAuth is a convenience,
not a dependency: public repository URLs remain a tokenless fallback and the
existing direct upload and CLI paths remain independent.

## Process boundary

The Cloudflare Worker performs URL detection, bounded provider metadata reads,
OAuth PKCE/OIDC verification, server-side reinspection, and transactional job
creation. It never downloads repository blobs. A separate macOS launch service
performs online provider downloads. The main Python runtime remains explicitly
offline and accepts only loopback-authenticated analysis requests from the
Bridge service.

```text
browser -> Cloudflare Worker -> Postgres job
                                  |
                                  v
                         online Bridge worker
                                  |
                 exact revision + Xet-aware snapshot
                                  |
               source manifest and checksum verification
                                  |
                 quarantine -> ClamAV -> Gitleaks
                                  |
                     offline format analysis
                                  |
                 immutable SHA-256 CAS + manifest
                                  |
                       human review required
```

## Identity and credential contract

- OAuth uses a public CIMD client, authorization code flow, PKCE S256, state,
  nonce, exact issuer and audience validation, RS256 JWKS validation, and an
  exact production redirect URI.
- The launch scope is `openid profile`. Private repositories, gated content,
  and organization memberships are separate user actions with separate scopes.
- Provider access tokens are AES-256-GCM encrypted with a deployment key held
  in Cloudflare secrets and macOS Keychain. The additional authenticated data
  is versioned as `superii-bridge-v1`.
- The worker never logs, returns, or writes plaintext provider tokens to disk.
  Disconnect revokes local use and clears the stored ciphertext and nonce.
- Personal namespace claims require a matching verified provider username.
  Organization claims require `read-memberships`, an exact provider
  organization subject, provider `admin` role, no unmet security restriction,
  and an available Super ii namespace.

## Import contract

- One file: at most 10 GiB. One repository: at most 20 GiB and 5,000 files.
  One user-selected import: at most 25 GiB and 50 repositories. One active job
  per profile is permitted.
- The Worker obtains file sizes, Git object IDs, LFS SHA-256 values, license,
  visibility, and the exact provider commit. Job creation re-reads every chosen
  source so a browser cannot supply trusted metadata.
- The online worker downloads only the allowlisted file manifest at the exact
  commit. It rejects traversal, aliases, unexpected files, symlinks, changed
  sizes, failed Git object IDs, and failed SHA-256 checksums before creating a
  destination revision.
- Each verified file still enters the normal quarantine-first storage pipeline.
  Missing or errored required scanners leave content unpublished. Failed gates
  reject the revision.
- Source cards and provenance are retained, but provider secrets, runtime
  secrets, followers, likes, discussions, and provider-specific history are not
  copied.
- Completion means `review`, never `published`. Existing PL/pgSQL review and
  release-manifest gates remain authoritative.

## Recovery and synchronization

Jobs are idempotent by profile and normalized source manifest. A heartbeat
distinguishes active work from interruption. Stale jobs are retried only before
a destination revision exists; a partially prepared revision fails closed for
manual review. Cancellation is checked before preparation and between files.

Update checks are opt-in, tokenless, and limited to sources proven public at
initial import. An unchanged provider commit performs no work. A changed commit
queues the same exact-revision pipeline and creates a new immutable revision;
it never overwrites a branch silently and still requires review.
