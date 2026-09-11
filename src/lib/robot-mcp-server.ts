import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { sqlClient } from './db';
import {
  componentCompatibility,
  componentCompatibilityClaims,
  makeRobotInputSchema,
  makeRobotPlan,
  robotCatalog,
  robotComponent,
  searchRobotComponents,
} from './robot';
import { getPublicRobot, listPublicRobots, robotJson } from './robot-store';

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);

function result(value: unknown) {
  const rendered = JSON.stringify(value, null, 2);
  if (rendered.length > 240_000) return error('bounded Robot MCP response size exceeded');
  return { content: [{ type: 'text' as const, text: rendered }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
}

async function recordDiscovery(locals: App.Locals, type: 'component' | 'robot' | 'catalog' | 'planner', key: string) {
  const sql = sqlClient(locals);
  if (sql) await sql`select app.record_robot_discovery('mcp',${type},${key})`.catch(() => undefined);
}

export function createSuperiiRobotMcpServer(locals: App.Locals, origin: string): McpServer {
  const server = new McpServer(
    { name: 'Super ii public Robot MCP', version: '1.0.0' },
    { instructions: 'Public and read-only. Preserve evidence state, source URL, checked date, conditions and unknowns. Unknown is not compatible. A plan is a starting design record, not a safety approval or instruction to energize hardware. Compatibility ranking is never influenced by payment.' },
  );

  server.registerResource('robot-machine-guide', `${origin}/robot/agents.md`, { title: 'Super ii Robot machine guide', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: 'Read the canonical guide at ' + uri.href }] }));
  server.registerResource('robot-catalog', `${origin}/api/robot/components`, { title: 'Source-backed Robot component catalog', mimeType: 'application/json' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ catalog_revision: robotCatalog.catalogRevision, components: robotCatalog.components }, null, 2) }] }));

  server.registerTool('search_robot_components', {
    title: 'Search Robot components',
    description: 'Search source-backed Robot component profiles. Results are ordered by evidence state and name, never by payment.',
    inputSchema: z.object({
      query: z.string().trim().max(120).optional(),
      platform: z.enum(['raspberry-pi', 'jetson']).optional(),
      category: z.enum(['compute', 'vision', 'thermal', 'power', 'mobile-base']).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(), annotations,
  }, async (input) => {
    await recordDiscovery(locals, 'catalog', 'components');
    const components = searchRobotComponents(input);
    return result({ catalog_revision: robotCatalog.catalogRevision, count: components.length, components });
  });

  server.registerTool('get_robot_component', {
    title: 'Get one Robot component',
    description: 'Return the exact component profile, sources, unknowns and all recorded pairwise claims.',
    inputSchema: z.object({ slug }).strict(), annotations,
  }, async ({ slug: componentSlug }) => {
    await recordDiscovery(locals, 'component', componentSlug);
    const component = robotComponent(componentSlug);
    return component ? result({ component, compatibility: componentCompatibilityClaims(componentSlug) }) : error('Robot component not found');
  });

  server.registerTool('check_robot_compatibility', {
    title: 'Check two Robot components',
    description: 'Return only recorded compatibility claims for this exact pair. An empty result means unknown, not compatible.',
    inputSchema: z.object({ left: slug, right: slug }).strict(), annotations,
  }, async ({ left, right }) => {
    const claims = componentCompatibility(left, right);
    return result({ left, right, state: claims.length ? 'recorded' : 'unknown', claims, warning: claims.length ? 'Apply every stated condition and verify the exact build.' : 'No pairwise evidence is recorded. Do not infer compatibility.' });
  });

  server.registerTool('make_robot_plan', {
    title: 'Make a first Robot plan',
    description: 'Create a deterministic Raspberry Pi 5 or Jetson Rover One starting plan with a parts list, source evidence, open requirements and Robot Check.',
    inputSchema: makeRobotInputSchema, annotations,
  }, async (input) => { await recordDiscovery(locals, 'planner', 'make-robot'); return result({ plan: makeRobotPlan(input) }); });

  server.registerTool('search_public_robots', {
    title: 'Search public Robots',
    description: 'Search real published community Robot versions. Empty results are never replaced with demo records.',
    inputSchema: z.object({ query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(10_000).default(0) }).strict(), annotations,
  }, async (input) => {
    const sql = sqlClient(locals);
    if (!sql) return error('public Robot database unavailable');
    try {
      await recordDiscovery(locals, 'catalog', 'public-robots');
      const robots = await listPublicRobots(sql, input);
      return result({ state: robots.length ? 'ok' : 'empty', count: robots.length, robots: robots.map((row) => robotJson(row, origin)) });
    } catch { return error('public Robot database unavailable'); }
  });

  server.registerTool('get_public_robot', {
    title: 'Get a public Robot',
    description: 'Return one published Robot and its current immutable version by owner and slug.',
    inputSchema: z.object({ owner: z.string().trim().min(1).max(80), slug }).strict(), annotations,
  }, async ({ owner, slug: robotSlug }) => {
    const sql = sqlClient(locals);
    if (!sql) return error('public Robot database unavailable');
    try {
      await recordDiscovery(locals, 'robot', `${owner}/${robotSlug}`);
      const robot = await getPublicRobot(sql, owner, robotSlug);
      return robot ? result({ robot: robotJson(robot, origin) }) : error('public Robot not found');
    } catch { return error('public Robot database unavailable'); }
  });
  return server;
}

export function createSuperiiRobotMcpHandler(locals: App.Locals, origin: string) {
  return createMcpHandler(() => createSuperiiRobotMcpServer(locals, origin), {
    route: '/mcp/robot', legacy: 'stateless',
    corsOptions: { origin: '*', methods: 'GET, POST, DELETE, OPTIONS', headers: 'content-type, mcp-protocol-version, mcp-session-id, last-event-id', exposeHeaders: 'mcp-session-id', maxAge: 86400 },
    allowedHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
    allowedOriginHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
  });
}
