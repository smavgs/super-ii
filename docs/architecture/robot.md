# Super ii Robot architecture

Super ii Robot connects agents, people, source-backed component information and
versioned engineering work. It does not replace robot frameworks, hardware
manufacturers, CAD tools, ROS, Viam, NVIDIA Isaac or specialist engineering
review. It gives those systems a shared, inspectable truth layer.

The first working path is intentionally narrow: `Make Robot` produces a bounded
mobile-rover plan around Raspberry Pi 5, with Jetson Orin Nano Super as the
advanced compute path. The data model and public protocols are not tied to one
agent vendor or user interface.

## Evidence model

The checked-in catalogue is the canonical public input. Each Component keeps:

- a stable slug, category, manufacturer and interface description;
- individual sources with publisher, URL and checked date;
- an evidence status of `verified`, `declared`, `derived` or `unknown`;
- explicit unknowns and cautions; and
- compatibility claims whose conditions and evidence remain attached.

`verified` means Super ii has direct evidence for the specific claim. A
manufacturer statement is `declared`, not silently upgraded to independent
verification. A derived fit is guidance, not a benchmark, warranty or safety
certification. Missing evidence remains unknown.

Compatibility order is deterministic and based on requirement fit and evidence
completeness. Plans, sponsorships and commercial relationships never improve
rank.

## Deterministic planning

`Make Robot` accepts a strict, bounded input describing goal, experience,
compute preference, environment and budget range. The server derives the plan
from the same versioned catalogue used by the browser, REST, MCP and A2A
interfaces. Clients cannot submit a replacement bill of materials or mark an
unknown as verified.

The output includes:

- a catalogue revision and reproducible planner input;
- a source-addressable bill of materials;
- compatibility checks with states and conditions;
- open requirements that must be resolved outside the planner; and
- a safety boundary that is always false for autonomous approval.

Saved Robots have immutable plan versions. Updating a Robot appends a version;
it cannot rewrite or delete the prior engineering record.

## Human and agent interfaces

Anonymous public reads are available through:

- HTML at `/robot` and public Robot/Component pages;
- REST under `/api/robot` and the service OpenAPI document;
- read-only MCP at `/mcp/robot`;
- A2A discovery at `/.well-known/robot-agent-card.json` and task requests under
  `/a2a/robot/v1`; and
- the compact machine guide at `/robot/agents.md`.

These contracts are protocol based, so any agent capable of ordinary HTTPS,
REST, MCP or A2A can use them regardless of model or vendor. Public operations
are bounded and rate limited.

Agent writes use the existing authenticated Work MCP. A human organization
owner or administrator creates an agent identity and issues a hash-at-rest,
expiring token with exact `robot:read`, `robot:create` or `robot:update` scopes.
Every mutation is bound to the operator organization, recomputes the canonical
plan on the server, requires an idempotency key and produces an immutable
receipt. A Work credential has zero payment authority.

No Robot endpoint authorizes physical actuator control, autonomous operation,
procurement or safety approval.

## Access boundaries

| Layer | Access |
| --- | --- |
| Public Component and Build retrieval, public planning and public publishing | Free |
| Private Builds and hardware inventory | Pro |
| Organization Robots, shared inventory, governed agent work and private-catalog foundation | Team |
| Reviewed manufacturer profile maintenance and meaningful aggregate agent-discovery analytics | Commercial organization workflow |
| Procurement | Later; not present in this release |
| Compatibility ranking | Never pay-to-win |

Manufacturer proposals are pending records. They do not modify the public
catalogue automatically. Analytics contain bounded daily aggregate counts, not
agent prompts, private plans, credentials or user-level tracking.

## Storage and enforcement

PostgreSQL enforces owner shape, plan requirements, organization roles,
immutable versions, bounded discovery aggregates and agent receipt
idempotency. Row-level security exposes only published public Robots and their
versions. Application routes separately authenticate private reads and writes,
validate request bodies, enforce same-origin browser mutations and apply rate
limits.

The public catalogue remains source controlled so a release can be reviewed,
reproduced and rolled back independently of user-created Robot data.

## Verification

`tools/check-robot.mjs` checks the catalogue, page, access language, protocols,
Work tools and migration contract. `database/tests/robot_smoke.sql` runs in a
rolled-back PostgreSQL 17 database and covers Free, Pro and Team gates,
immutable versions, personal/shared inventory foundations, manufacturer
proposals, discovery aggregation, scoped agent authorization, governed agent
creation and exact idempotent replay. The normal type, route, build and browser
checks remain release requirements.
