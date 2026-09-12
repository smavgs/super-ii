# Super ii Transparent architecture

Super ii Transparent turns bounded public Hugging Face evidence into a permanent, exact-revision report. It is an evidence reader, not a crawler, code runner, trust score, safety certificate, or Hugging Face partnership.

## Initial product boundary

- Provider: Hugging Face only.
- Artifacts: public model, dataset, and Space repositories.
- Inputs: a repository URL or `owner/repository`, plus an optional branch, tag, or commit.
- Output: one immutable report identified by provider, repository kind, normalized repository ID, resolved provider commit, and criteria version.
- First check: anonymous and public.
- User features: save, watch, compare, submit public evidence, verified creator claim, and immutable creator response.
- Agent features: public check, get, search, and compare; narrowly scoped authenticated watch.

## Evidence semantics

Reports have exactly four evidence states:

1. `verified`: the checker directly observed the item in approved public evidence at the exact commit. This does not establish safety, truth, legality, quality, completeness, or endorsement.
2. `declared`: the creator or Hugging Face states the item. Super ii did not independently reproduce it.
3. `derived`: a documented method calculates the item from directly observed metadata.
4. `unknown`: checked public evidence does not establish the item. Unknown is never rewritten as absent, false, safe, or incompatible.

No aggregate trust score or hidden grade is computed. Coverage is only the number of fields whose state is not `unknown`.

## Bounded provider read

The parser accepts HTTPS Hugging Face repository URLs and repository IDs only. It rejects credentials, custom ports, unsupported paths, invalid owner or slug segments, traversal, and unsafe revisions. The engine constructs provider requests itself rather than fetching a user-supplied URL.

Repository metadata is requested from the official model, dataset, or Space API at the requested revision. The result must match the requested repository and contain a provider commit SHA. Provider responses are time bounded and byte bounded. The repository file list is capped. Only small root evidence files such as `README.md`, `config.json`, and `dataset_infos.json` are read, and only through an exact-revision provider URL. Manual redirects are accepted only to the approved Hugging Face resolve-cache path on an approved Hugging Face host.

The checker never imports or executes repository code, starts a Space, loads a model, downloads weights, follows links from repository content, or fetches a submitted correction URL. Submitted evidence enters a review queue as data.

## Persistence and immutability

The report key is a SHA-256 digest of the provider, artifact kind, case-normalized repository ID, exact revision, and criteria version. Repeating a check reuses the existing stored report; its original check time, sources, and evidence are not silently refreshed. A changed source revision creates a separate report, and comparison operates on two stored reports for the same repository.

PostgreSQL prevents report snapshot mutation and creator-response mutation. The public report may be augmented with separately stored, visibly labeled community context:

- a unique verified repository claim;
- append-only creator responses or corrections;
- reviewed evidence submissions.

These records never rewrite the historical report.

## Watches and notifications

A watch starts from a stored report. When a new report for the same provider, artifact kind, and repository is inserted with a different revision, the database advances matching enabled watches and records a member notification. Merely revisiting an existing report does not manufacture a change. Browser watches require a same-origin signed-in session. Agent watches require the separately issued `transparent:watch` scope, a stable idempotency key, and an immutable action receipt.

## Creator verification

A creator claim requires a current Super ii profile with either:

- a connected, unrevoked Hugging Face OAuth identity whose provider username matches the repository owner; or
- an independently verified Hugging Face organization namespace matching that owner.

One repository can have only one active verified profile claim. Claiming does not transfer, import, modify, or publish the Hugging Face repository.

## Interfaces

- Human checker and public report directory: `https://superii.site/transparent`
- Permanent report: `https://superii.site/transparent/{report_key}`
- REST: `/api/transparent/check`, `/api/transparent/reports`, `/api/transparent/reports/{report_key}`, and `/api/transparent/compare`
- MCP: `https://superii.site/mcp/transparent`
- Machine guide: `https://superii.site/transparent/agents.md`
- OpenAPI: `https://superii.site/openapi.json`

REST and MCP call the same checker and persistence modules. Report state names and meanings are identical across HTML, JSON, and MCP.

## Acquisition and account surfaces

The homepage presents a thin orange checker immediately after AI Worker. Bring My Work presents the same independent check after Verified Arrival, clearly separate from import or ownership. A checked report has its own permanent public page. Signed-in Workspace lists saved, watched, and claimed reports. Hugging Face is named only as the evidence source; no affiliation, endorsement, or partnership is implied.

## Commercial boundary

The initial public checker is an acquisition surface. Private evidence, organization policy, team audit, and deeper governed workflows may become plan capabilities later, but paid status must never change an evidence state, hide an unknown, or buy a favorable ranking. This release makes no private-repository check or safety-assessment claim.
