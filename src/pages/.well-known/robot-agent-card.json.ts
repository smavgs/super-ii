import type { APIRoute } from 'astro';

export const prerender = true;

export const robotAgentCard = {
  name: 'Super ii Robot Agent',
  description: 'Search source-backed Robot components, inspect evidence, check exact component pairs, make Raspberry Pi or Jetson starting plans, and retrieve real published Robots. Public and read-only. Unknown is never presented as compatible.',
  supportedInterfaces: [{ url: 'https://superii.site/a2a/robot/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
  provider: { organization: 'Super ii', url: 'https://superii.site' },
  iconUrl: 'https://superii.site/brand/super-ii-logo.png',
  version: '1.0.0',
  documentationUrl: 'https://superii.site/robot/agents.md',
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  defaultInputModes: ['application/json', 'text/plain'],
  defaultOutputModes: ['application/json'],
  skills: [
    { id: 'robot-search-components', name: 'Search Robot components', description: 'Search source-backed components by text, platform or category.', tags: ['robotics', 'components', 'raspberry-pi', 'jetson'], examples: ['{"skillId":"robot-search-components","arguments":{"platform":"raspberry-pi","limit":10}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
    { id: 'robot-get-component', name: 'Inspect one component', description: 'Read exact specifications, sources, evidence state and unknowns.', tags: ['robotics', 'evidence'], examples: ['{"skillId":"robot-get-component","arguments":{"slug":"raspberry-pi-5"}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
    { id: 'robot-check-compatibility', name: 'Check a component pair', description: 'Return only recorded pairwise claims. Empty means unknown.', tags: ['robotics', 'compatibility', 'safety'], examples: ['{"skillId":"robot-check-compatibility","arguments":{"left":"raspberry-pi-5","right":"waveshare-wave-rover"}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
    { id: 'robot-make-plan', name: 'Make a Robot plan', description: 'Create a deterministic Rover One starting plan with parts, evidence and open requirements.', tags: ['robotics', 'planning', 'raspberry-pi', 'jetson'], examples: ['{"skillId":"robot-make-plan","arguments":{"goal":"learn","experience":"new","compute":"recommend","environment":"indoor","budget":"not-sure","owned_components":[]}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
    { id: 'robot-search-public', name: 'Search published Robots', description: 'Search real public community Robot versions.', tags: ['robotics', 'community', 'versions'], examples: ['{"skillId":"robot-search-public","arguments":{"limit":20,"offset":0}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
    { id: 'robot-get-public', name: 'Get a published Robot', description: 'Retrieve one current immutable public Robot version.', tags: ['robotics', 'versions', 'evidence'], examples: ['{"skillId":"robot-get-public","arguments":{"owner":"maker","slug":"rover-one"}}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
  ],
};

export const GET: APIRoute = () => new Response(JSON.stringify(robotAgentCard, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600', etag: '"superii-robot-agent-1.0.0"', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
