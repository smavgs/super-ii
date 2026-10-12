# Workspace workrooms verification

The common working surface covers models, datasets, apps, notebooks, research,
robots, components and hardware. Personal creators can start without a company.
The implementation passed local verification on 11 October. The production
rollout and independent live checks below completed on 12 October.

## Verified locally

- Real PostgreSQL 17: all 35 migrations applied twice, transactional suite passed.
  All three workroom tables use RLS; runtime roles have no direct table CRUD and
  only the designated web role can execute the narrow gateways.
- 55 requests through the actual HTTP/MCP handlers: unauthenticated reads,
  cross-origin writes, unsafe reference links, personal/team isolation,
  viewer/editor/removal, stale saves, exact retries and conflicting retries,
  all eight work kinds, completion review, repository-bound agent scopes,
  pagination over 52 rooms, atomic one-action budgets and revocation.
- Chrome on disposable local data: create a personal dataset room, add a result,
  select the reviewed result, save completion, reload and open it from the
  completed-work filter. Exclusive detail panels and downloaded JSON handoff
  were verified. The handoff contains the saved context and no credentials.
- Chinese at 390 px: no page-wide horizontal overflow. Russian and dark theme:
  labels, actions and results remain readable. Creator-authored text retains its
  language. The site's locale cache versions are advanced for the new catalogue.
- Source references do not fetch or run arbitrary code. Build & Ship accepts
  only published pinned input revisions; saving a generated plan creates a note,
  never an execution result or completion. Existing publication policy remains
  separate.

## Release and evidence boundaries

No production test accounts, workrooms, uploads, companies, products, inquiries
or repositories are created for verification. Local browser identity injection
exists only in the opt-in disposable integration-test proxy; no fixture route
ships. Mainland/WeChat testing remains deferred, and the existing three lifetime
successful Showcase-upload allowance is unchanged.

The direct agent report path currently requires a team room with an organization
repository. A personal room can download a handoff for any chosen agent and save
its reported results manually. A report is evidence supplied by a member/agent;
member review does not independently verify correctness, safety or execution.

Universal Git import/execution, browser notebook execution, a new local runtime,
Lean proofs and community compute are outside this release. The existing Bridge,
notebooks, runnable recipes and repository/product editors remain available.

## Production verification — 12 October 2026

PR #100 merged as `a2b059be70e42c3b1f6f64519825ad398d7756c6` after all eight
required checks and aggregate CodeQL passed. The merged tree matches the tested
source. Migration 0035 committed once in a transaction after preservation checks:
8 repositories, 9 revisions and 63 files are unchanged, together with business
records, agent credentials/receipts and existing function grants. All three new
tables have RLS, no direct runtime-role CRUD and only the intended gateway grants.

Worker `e16d6531-1052-487d-81f9-21f5c6fadff2` deployed with existing variables
retained. Each domain passed 12 new read/access-boundary requests plus the existing
40 machine-access checks. Anonymous Workroom reads/writes and MCP tool calls are
denied. OAuth metadata advertises the explicit new scopes. Signed-in Chrome
verified the Workspace entry, real authorized repository choices, all eight work
kinds, English/Russian/Chinese forms and 390 px Chinese layout without overflow.
No form was submitted and no production test content or credential was created.

Locale JSON is a browser resource behind the existing Browser Integrity Check;
ordinary Python requests receive 403 there. Rendered language editions were
verified in Chrome without changing protection rules. The first actual member
room and production agent report remain pending. Production deployment is not a
claim of GA, independent result verification or a completed real-user journey.
