import type { APIRoute } from 'astro';

export const prerender = true;

const document = `# Super ii Transparent

Super ii Transparent creates permanent evidence reports for public Hugging Face model, dataset, and Space repositories. Hugging Face identifies the source; no partnership, endorsement, or affiliation is implied.

Human checker: https://superii.site/transparent

MCP transport: https://superii.site/mcp/transparent

REST:

- POST https://superii.site/api/transparent/check
- GET https://superii.site/api/transparent/reports?q=owner%2Frepository
- GET https://superii.site/api/transparent/reports/{report_key}
- GET https://superii.site/api/transparent/compare?left={report_key}&right={report_key}
- POST https://superii.site/api/transparent/reports/{report_key}/recheck

The complete request and response schemas are in https://superii.site/openapi.json.

MCP tools:

- check_huggingface_transparency
- get_transparency_report
- compare_huggingface_revisions
- search_public_transparency_reports
- watch_transparency_report (requires a human-issued sii_agent_ token with transparent:watch)

The first four tools are public. Watching is the only MCP mutation. It requires a separate short-lived sii_agent_ Bearer credential, transparent:watch scope, and a stable 16–200 character idempotency_key used only for an exact retry. It creates an immutable action receipt and grants no repository, publication, compute, identity, Social, commerce, wallet, or billing authority.

## Input boundary

Use a public repository root, owner/repository ID, or an exact Hugging Face tree, blob, or commit URL. Datasets use /datasets/owner/repository and Spaces use /spaces/owner/repository. Optional revision accepts a branch, tag, or commit; otherwise the URL revision or main is resolved.

The engine constructs every provider request. It accepts only HTTPS Hugging Face hosts and approved repository endpoints, follows only a bounded Hugging Face resolve-cache redirect, and enforces provider time, byte, evidence-file, and repository-file-count limits. It does not follow links from repository content or fetch a creator-submitted evidence URL during submission.

Evidence states are strict:

- verified: directly observed at the exact commit; never interpret this as safe, true, lawful, certified, or endorsed
- declared: stated by the repository creator or Hugging Face; not independently reproduced
- derived: computed from observed metadata, with the method included
- unknown: the checked public evidence does not establish the field

Coverage counts fields that are not unknown. It is not a quality score, trust score, safety score, rank, recommendation, accusation, or certification.

## Permanent report behavior

report_key is deterministic for the provider, repository kind, case-normalized repository ID, resolved provider commit, and criteria version. Rechecking the same inputs reuses the stored report rather than changing its check time or evidence. A new provider commit creates a different immutable report. Compare only reports for the same provider repository.

A public report can display separately stored community context. A creator claim requires a matching current Hugging Face OAuth owner identity or verified organization namespace. Creator responses are append-only and visibly labeled. Evidence suggestions enter review. Claims, responses, and suggestions never rewrite the historical report.

## Failure behavior

- 404 means the public repository, revision, or stored report was not found or could not be read publicly.
- 413 means a documented checker size or file-count bound was exceeded.
- 422 means the source, revision, search, comparison, or submission did not match the strict schema.
- 429 means the current bounded rate limit was reached.
- 502 means provider evidence was malformed or violated the provider boundary.
- 503 means a required provider, database, or safety control was unavailable.

Do not fabricate a report, substitute another revision, or turn a 404, 429, 502, or 503 into a successful result. A permanent report URL is https://superii.site/transparent/{report_key}.

Always preserve report_key, repository.resolved_revision, criteria_version, checked_at, source URLs, evidence state, derivation method, and limitations. Never convert unknown to compatible, safe, absent, or false. Never execute repository code or model weights.
`;

export const GET: APIRoute = async () => new Response(document, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600', 'x-content-type-options': 'nosniff' } });
