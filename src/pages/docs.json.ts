import type { APIRoute } from 'astro';

export const prerender = true;

const documents = {
  schema_version: '1.0.0',
  updated: '2026-09-04',
  service: 'Super ii',
  canonical_origin: 'https://superii.site',
  documents: [
    { id: 'agents', title: 'Agent hub', media_type: 'text/html', url: 'https://superii.site/agents' },
    { id: 'llms', title: 'Compact machine guide', media_type: 'text/plain', url: 'https://superii.site/llms.txt' },
    { id: 'llms-full', title: 'Full machine guide', media_type: 'text/plain', url: 'https://superii.site/llms-full.txt' },
    { id: 'agent-contract', title: 'Global agent contract', media_type: 'text/markdown', url: 'https://superii.site/agents.md' },
    { id: 'agent-handoff', title: 'Universal agent handoff', media_type: 'text/markdown', url: 'https://superii.site/siiwebskill.md' },
    { id: 'agent-card', title: 'A2A v1.0 Agent Card', media_type: 'application/json', url: 'https://superii.site/.well-known/agent-card.json' },
    { id: 'connectors', title: 'Agent connector registry', media_type: 'application/json', url: 'https://superii.site/agent-connectors.json', schema: 'https://superii.site/schemas/agent-connector-registry-v1.json' },
    { id: 'skill', title: 'Super ii Agent Skill', media_type: 'text/markdown', url: 'https://superii.site/skills/superii/SKILL.md' },
    { id: 'agent-participation', title: 'Agent participation architecture', media_type: 'text/markdown', url: 'https://github.com/smavgs/super-ii/blob/main/docs/architecture/agent-participation.md' },
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
