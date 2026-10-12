# Workrooms in Workspace

## Product and visual thesis

Workspace is a person's working home. Models, datasets, apps, notebooks, research,
robots, components and hardware use the same saved workroom, with relevant actions
for each kind. A personal project does not require a company. Existing repository,
Bridge, notebook, recipe and product editors remain the places that do the work.

Use the existing navy, yellow, typography and navigation. Put work in progress
before the library. Use compact rows and one selected room; no marketing hero,
carousel, new top-level navigation or wall of configuration. The room shows its
goal and next action first, then expandable source, result history and access.
On phones, use one column, native labels and controls, visible focus and no
horizontal scrolling. Interaction is limited to opening relevant details,
saving, resuming and reporting progress; respect reduced motion.

## Delivered contract

A workroom saves its desired outcome, acceptance criteria, next action, source
reference and optional exact Super ii revision. It is private to its owner,
explicit collaborators, or the selected organization's members. Viewers can
read; editors can add notes and update work. Only the owner controls explicit
collaborators. Organization membership is checked on every request.

The member can start with an existing repository, a public HTTPS link, or an
idea. GitHub, GitLab, Codeberg, Hugging Face and other public links can be kept as
references. This does not clone, import, execute or establish ownership of that
source. The existing Hugging Face Bridge remains the automated import route.

Each result is explicitly reported evidence. A member must review a result
before marking work complete. This is a workflow decision, not independent
verification of execution, quality, safety or publication. Repository publication
continues to use the existing independent checks. Private completion is valid.

Agents use new opt-in `workroom:read` and `workroom:report` scopes, bound to an
organization-owned repository and a room in that same organization. Old tokens
gain no authority. Reports are atomic, idempotent, budgeted and receipted. Agents
cannot change the goal, members or completion decision. A portable handoff lets
any agent help with personal work without granting write access.

## Boundaries and follow-on engineering

This release makes the persistent common working surface real. It does not claim
universal Git import/execution, JupyterLite, a new Rust local companion, Lean
verification, peer discovery or community compute. These need their own execution
and isolation evidence. Existing tested notebook/recipe paths remain available;
generated plans, local reported runs and independently checked releases retain
different evidence labels. No production test records are needed to validate
this release. Showcase limits and deferred mainland/WeChat testing are unchanged.

## Storage and release

Migration 0035 adds private workrooms, append-only entries and collaborators.
Runtime roles receive only narrow gateway functions; no direct table grants.
Optimistic versions prevent overwriting another editor's work. Stable UUID keys
prevent duplicate creation and reports. Current permissions are rechecked on
retries. Limits bound room and entry growth. The migration is additive and
rerunnable. Deploy only after real PostgreSQL tenant/agent tests, HTTP tests,
type checks, build and browser checks. Production verification stays read-only.
