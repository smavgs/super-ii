import type { APIRoute } from 'astro';

export const prerender = true;

export const superiiAgentCard = {
  name: 'Super ii Public Discovery Agent',
  description: 'Search and inspect reviewed public AI models, datasets, apps, provenance, compatibility, and checksum-verified downloads without executing repository code.',
  supportedInterfaces: [{
    url: 'https://superii.site/a2a/v1',
    protocolBinding: 'HTTP+JSON',
    protocolVersion: '1.0',
  }],
  provider: {
    organization: 'Super ii',
    url: 'https://superii.site',
  },
  iconUrl: 'https://superii.site/brand/super-ii-logo.png',
  version: '1.0.0',
  documentationUrl: 'https://superii.site/agents',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  defaultInputModes: ['application/json', 'text/plain'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: 'search-public-catalog',
      name: 'Search reviewed public AI repositories',
      description: 'Search models, datasets, or apps using bounded metadata, recency, size, hardware, and compatibility filters. Empty results are real.',
      tags: ['ai', 'models', 'datasets', 'apps', 'discovery'],
      examples: ['{"skillId":"search-public-catalog","arguments":{"kind":"model","query":"text embedding","limit":10}}'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    },
    {
      id: 'inspect-public-repository',
      name: 'Inspect a reviewed repository',
      description: 'Return one public repository identity, immutable revision, compatibility, provenance, lineage, analysis, community metrics, and machine representations.',
      tags: ['repository', 'provenance', 'compatibility', 'manifest'],
      examples: ['{"skillId":"inspect-public-repository","arguments":{"kind":"model","owner":"owner","slug":"model"}}'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    },
    {
      id: 'resolve-verified-download',
      name: 'Resolve a checksum-verified download',
      description: 'Resolve an exact file in a reviewed immutable revision and return its URL, byte size, media type, and SHA-256 without downloading or executing it.',
      tags: ['files', 'download', 'sha256', 'integrity'],
      examples: ['{"skillId":"resolve-verified-download","arguments":{"kind":"dataset","owner":"owner","slug":"dataset","path":"data/train.parquet"}}'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    },
    {
      id: 'read-system-state',
      name: 'Read Super ii capability state',
      description: 'Return the canonical evidence-based capability and availability register.',
      tags: ['status', 'availability', 'evidence'],
      examples: ['{"skillId":"read-system-state","arguments":{}}'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    },
  ],
};

const body = JSON.stringify(superiiAgentCard, null, 2);

export const GET: APIRoute = async () => new Response(body, {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300, s-maxage=3600',
    etag: '"superii-public-agent-1.0.0"',
    'x-content-type-options': 'nosniff',
  },
});
