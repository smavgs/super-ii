# Resumable transfer contract

Large repository files use a TUS 1.0-compatible, capability-scoped path instead of one edge request. The policy ceiling is 10 GiB per file; the implementation never interprets that ceiling as a promise of free storage capacity.

## Trust and state

1. An authenticated repository uploader supplies the exact revision, safe path, MIME type, size, and complete SHA-256 digest.
2. Postgres transactionally creates one expiring transfer row and stores only the SHA-256 hash of its capability.
3. The returned capability is HMAC-authenticated, key-separated, short-lived, and bound to transfer, repository, revision, profile, size, checksum, and expiry.
4. Browser resume metadata stays in same-origin session storage. The token is neither logged nor placed in a URL.
5. Astro verifies the ticket and database binding on every `HEAD`, `PATCH`, `DELETE`, status, and commit request.

## Data path

- The browser hashes the complete file incrementally, then sends 8 MiB chunks.
- Cloudflare streams each chunk through without buffering the complete file.
- The Rust sidecar accepts only loopback traffic authenticated by the trusted runtime token.
- A per-transfer lock serializes writes; each patch must match the durable offset and declared chunk length.
- SHA-1 or SHA-256 TUS chunk checksums are verified before durable offset advancement.
- Transfer metadata and bytes live in quarantine with safe, fixed server-side paths and explicit expiry.
- Commit verifies exact length and the complete SHA-256 digest before the Python scanner pipeline receives the object.
- ClamAV, Gitleaks, format policy, applicable offline analysis, release manifest, and human review remain mandatory.
- Clean bytes are atomically promoted into SHA-256 content-addressed storage with an integrity receipt; rejected or inconsistent bytes never become public.

## Recovery and CLI

The control plane reconciles Postgres to the Rust service's durable offset before accepting another chunk. Expired, terminated, rejected, or conflicting sessions fail closed. The Rust CLI uses the same protocol, stores its short-lived transfer capability and source identity only in a mode-`0600` resume file, removes that file after success, supports ranged downloads, and checks the complete digest after pull or explicit verify.

No browser request can address an arbitrary host path, choose a CAS key, bypass scanners, or publish a revision.
