# Workspace workrooms verification

The common working surface covers models, datasets, apps, notebooks, research,
robots, components and hardware. Personal creators can start without a company.
This record initially describes local verification; live evidence is appended
only after the production migration and Worker are independently checked.

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
