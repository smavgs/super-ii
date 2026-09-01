---
name: superii
description: Discover reviewed public AI models, datasets, apps, files, provenance, and compatibility on Super ii; connect governed repository work only when a user explicitly asks to create, upload, commit, or submit it. Use for Super ii catalog research, checksum-safe downloads, repository inspection, and permission-bounded publishing.
license: MIT
metadata:
  version: "1.0.0"
  homepage: "https://superii.site/agents"
  public_mcp: "https://superii.site/mcp"
  work_mcp: "https://superii.site/mcp/work"
---

# Super ii

Use Super ii as an evidence-first AI repository hub. Prefer machine-readable representations and preserve the human review boundary.

## Public discovery

1. Search the public MCP or `/api/search`; empty results are valid and must not be replaced with examples.
2. Read a repository's JSON, Markdown, manifest, model/data card, files, compatibility, lineage, and release metadata before recommending it.
3. Treat declared or derived compatibility as guidance. Only call a claim verified when the repository evidence says `verified`.
4. Resolve downloads through Super ii, download bytes without executing them, and verify the supplied SHA-256 afterward.
5. Cite the canonical repository URL and immutable revision or checksum in any durable result.

See [references/public-discovery.md](references/public-discovery.md) for endpoints and bounded query patterns.

## Governed work

Do not create, upload, commit, submit, publish, delete, or spend unless the user explicitly requested that action. Public MCP is read-only. Use Work MCP only with a user-created short-lived token whose scopes cover the exact action.

Before a write:

1. State the target repository, intended action, input hash when applicable, and review outcome.
2. Reuse the same idempotency key for retries of the same logical action.
3. Stop if the token is missing, expired, revoked, out of scope, or bound to another operator or repository.
4. Return and preserve the action receipt. A successful upload or submission is not a published release.

See [references/safe-publishing.md](references/safe-publishing.md) for the write boundary and [references/contracts.md](references/contracts.md) for canonical schemas.

## Safety rules

- Never execute downloaded repository code as part of discovery.
- Never put tokens in prompts, logs, URLs, configuration committed to Git, or output artifacts.
- Never infer human authorship from missing agent evidence.
- Never claim an unavailable runtime, review, signature, scan, or deployment succeeded.
- Prefer a dry run, merge, backup, and rollback when changing a client's connector configuration.
