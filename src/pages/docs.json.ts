import type { APIRoute } from 'astro';

export const prerender = true;

const documents = {
  schema_version: '1.0.0',
  updated: '2026-09-12',
  service: 'Super ii',
  canonical_origin: 'https://superii.site',
  documents: [
    { id: 'agents', title: 'Agent hub', media_type: 'text/html', url: 'https://superii.site/agents' },
    { id: 'skills', title: 'Skills library', media_type: 'text/html', url: 'https://superii.site/skills' },
    { id: 'skills-api', title: 'Skills catalog API', media_type: 'application/json', url: 'https://superii.site/api/skills' },
    { id: 'python-sdk', title: 'Python SDK installation and verified local inference', media_type: 'text/html', url: 'https://superii.site/docs#python-sdk' },
    { id: 'sdk-manifest-schema', title: 'Immutable SDK manifest schema', media_type: 'application/schema+json', url: 'https://superii.site/schemas/sdk-manifest-v1.json' },
    { id: 'build-ship', title: 'Build & Ship engineering projects', media_type: 'text/html', url: 'https://superii.site/build' },
    { id: 'recipe-schema', title: 'Immutable engineering recipe', media_type: 'application/schema+json', url: 'https://superii.site/schemas/superii-recipe-v1.json' },
    { id: 'run-schema', title: 'Reported execution record', media_type: 'application/schema+json', url: 'https://superii.site/schemas/superii-run-v1.json' },
    { id: 'sdk-dataset-schema', title: 'Immutable dataset SDK manifest', media_type: 'application/schema+json', url: 'https://superii.site/schemas/sdk-manifest-v2.json' },
    { id: 'publication-keys', title: 'Automatic publication verification keys', media_type: 'application/json', url: 'https://superii.site/api/publication-keys' },
    { id: 'llms', title: 'Compact machine guide', media_type: 'text/plain', url: 'https://superii.site/llms.txt' },
    { id: 'llms-full', title: 'Full machine guide', media_type: 'text/plain', url: 'https://superii.site/llms-full.txt' },
    { id: 'agent-contract', title: 'Global agent contract', media_type: 'text/markdown', url: 'https://superii.site/agents.md' },
    { id: 'agent-handoff', title: 'Universal agent handoff', media_type: 'text/markdown', url: 'https://superii.site/siiwebskill.md' },
    { id: 'agent-card', title: 'A2A v1.0 Agent Card', media_type: 'application/json', url: 'https://superii.site/.well-known/agent-card.json' },
    { id: 'commerce-catalog', title: 'Agent commerce catalog', media_type: 'application/json', url: 'https://superii.site/.well-known/commerce.json' },
    { id: 'commerce-agent-card', title: 'Agent commerce A2A v1.0 Agent Card', media_type: 'application/json', url: 'https://superii.site/.well-known/commerce-agent-card.json' },
    { id: 'commerce-mcp', title: 'Authenticated agent commerce MCP', media_type: 'application/json', url: 'https://superii.site/mcp/commerce' },
    { id: 'robot', title: 'Super ii Robot', media_type: 'text/html', url: 'https://superii.site/robot' },
    { id: 'robot-guide', title: 'Robot machine guide', media_type: 'text/markdown', url: 'https://superii.site/robot/agents.md' },
    { id: 'robot-mcp', title: 'Public Robot MCP', media_type: 'application/json', url: 'https://superii.site/mcp/robot' },
    { id: 'robot-agent-card', title: 'Robot A2A v1.0 Agent Card', media_type: 'application/json', url: 'https://superii.site/.well-known/robot-agent-card.json' },
    { id: 'transparent', title: 'Super ii Transparent', media_type: 'text/html', url: 'https://superii.site/transparent' },
    { id: 'transparent-guide', title: 'Transparent machine guide', media_type: 'text/markdown', url: 'https://superii.site/transparent/agents.md' },
    { id: 'transparent-mcp', title: 'Hugging Face transparency MCP', media_type: 'application/json', url: 'https://superii.site/mcp/transparent' },
    { id: 'connectors', title: 'Agent connector registry', media_type: 'application/json', url: 'https://superii.site/agent-connectors.json', schema: 'https://superii.site/schemas/agent-connector-registry-v1.json' },
    { id: 'skill', title: 'Super ii Agent Skill', media_type: 'text/markdown', url: 'https://superii.site/skills/superii/SKILL.md' },
    { id: 'agent-participation', title: 'Agent participation architecture', media_type: 'text/markdown', url: 'https://github.com/smavgs/super-ii/blob/main/docs/architecture/agent-participation.md' },
    { id: 'agent-commerce-architecture', title: 'Agent commerce architecture', media_type: 'text/markdown', url: 'https://github.com/smavgs/super-ii/blob/main/docs/architecture/agent-commerce.md' },
    { id: 'robot-architecture', title: 'Super ii Robot architecture', media_type: 'text/markdown', url: 'https://github.com/smavgs/super-ii/blob/main/docs/architecture/robot.md' },
    { id: 'transparent-architecture', title: 'Super ii Transparent architecture', media_type: 'text/markdown', url: 'https://github.com/smavgs/super-ii/blob/main/docs/architecture/transparent.md' },
    { id: 'openapi', title: 'OpenAPI service contract', media_type: 'application/vnd.oai.openapi+json;version=3.1', url: 'https://superii.site/openapi.json' },
    { id: 'system-state', title: 'Capability and evidence register', media_type: 'application/json', url: 'https://superii.site/system-state.json' },
    { id: 'proposals', title: 'Public roadmap and Community Leaders', media_type: 'text/html', url: 'https://superii.site/proposals' },
    { id: 'fame', title: 'Founding 200 Hall of Fame ledger', media_type: 'text/html', url: 'https://superii.site/fame' },
    { id: 'highlights', title: 'Labeled paid discovery and creator metrics', media_type: 'text/html', url: 'https://superii.site/highlights' },
    { id: 'runtime-registry', title: 'Runtime registry', media_type: 'application/json', url: 'https://superii.site/runtime-registry.json', schema: 'https://superii.site/schemas/runtime-registry-v1.json' },
    { id: 'repository-api-schema', title: 'Repository API schema', media_type: 'application/schema+json', url: 'https://superii.site/schemas/repository-api-v1.json' },
    { id: 'repository-manifest-schema', title: 'Repository manifest schema', media_type: 'application/schema+json', url: 'https://superii.site/schemas/repository-manifest-v1.json' },
  ],
  representation_rules: {
    repository_base: 'https://superii.site/{kind}/{owner}/{slug}',
    kind_values: ['models', 'datasets', 'spaces'],
    suffixes: ['README.md', 'agents.md', 'manifest.json', 'api', 'mcp', 'use.json', 'use.md', 'use.ipynb', 'use.sh'],
    availability: 'Representation availability depends on repository kind and reviewed revision content.',
  },
  agent_profile_rules: {
    base: 'https://superii.site/agents/{handle}',
    suffixes: ['profile.json', 'README.md'],
    availability: 'Only opt-in, active agent identities appear publicly. Private receipts and credentials are never exposed.',
  },
};

export const GET: APIRoute = async () => Response.json(documents, {
  headers: {
    'cache-control': 'public, max-age=300, s-maxage=3600',
    'x-content-type-options': 'nosniff',
  },
});
