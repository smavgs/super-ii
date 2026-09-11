import type { APIRoute } from 'astro';
import { robotCatalog } from '@/lib/robot';

export const prerender = true;

const body = `# Super ii Robot machine guide

> Contract 1.0 · catalog ${robotCatalog.catalogRevision} · English source only

Super ii Robot connects Robot components, source evidence, compatibility claims, plans and versioned community Robots. It does not manufacture hardware, sell components, control a physical Robot, or replace safety engineering.

## Public access

- Human interface: https://superii.site/robot
- Robot MCP: https://superii.site/mcp/robot
- Robot A2A Agent Card: https://superii.site/.well-known/robot-agent-card.json
- Robot A2A base: https://superii.site/a2a/robot/v1
- OpenAPI: https://superii.site/openapi.json
- Components REST: https://superii.site/api/robot/components
- Public Robots REST: https://superii.site/api/robot/robots

Public component search, profile retrieval, pairwise compatibility lookup, deterministic Make Robot planning and published Robot retrieval are anonymous and read-only. Empty results are authoritative. Never infer compatibility from the absence of a recorded conflict.

## Evidence states

- verified: Super ii records direct test evidence for the exact claim and conditions.
- declared: an identified official or manufacturer source makes the claim.
- derived: Super ii derives the claim from named facts; it is guidance, not a test.
- unknown: adequate evidence is missing. Unknown is not compatible.

Every component claim returns sources and checked dates. A plan returns open requirements and a Robot Check. Preserve those fields when presenting recommendations.

## Governed write access

Human account owners issue short-lived \`sii_agent_\` credentials in Workspace. The authenticated Work MCP at https://superii.site/mcp/work supports Robot draft creation and immutable version creation when the token includes the matching Robot scope. Organization Robot work requires a current Team or Enterprise entitlement. Private personal Robots and My Hardware require Pro or higher. Tokens never grant purchasing, wallet, physical actuator or safety-approval authority.

## Commercial boundary

Public Component and Build retrieval is Free. Private Builds and hardware inventory are Pro. Shared engineering work, policies, audit and private catalogs are Team. Manufacturer maintenance and meaningful agent-discovery analytics are commercial and review-bound. Procurement is not available. Payment never changes organic compatibility ranking.

## Safety boundary

Treat every plan as a starting design record. Confirm voltage, current, battery protection, connector pinout, dimensions, mounting, thermals, software versions, stop behavior and supervised testing before energizing or moving hardware. A missing claim stays unknown.
`;

export const GET: APIRoute = () => new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
