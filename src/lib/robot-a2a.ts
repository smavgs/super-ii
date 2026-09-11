import { z } from 'zod';
import type { A2AExecution } from './a2a';
import { sqlClient } from './db';
import { componentCompatibility, makeRobotInputSchema, makeRobotPlan, robotComponent, searchRobotComponents } from './robot';
import { getPublicRobot, listPublicRobots, robotJson } from './robot-store';

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const requestSchema = z.discriminatedUnion('skillId', [
  z.object({ skillId: z.literal('robot-search-components'), arguments: z.object({ query: z.string().trim().max(120).optional(), platform: z.enum(['raspberry-pi', 'jetson']).optional(), category: z.enum(['compute', 'vision', 'thermal', 'power', 'mobile-base']).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict() }).strict(),
  z.object({ skillId: z.literal('robot-get-component'), arguments: z.object({ slug }).strict() }).strict(),
  z.object({ skillId: z.literal('robot-check-compatibility'), arguments: z.object({ left: slug, right: slug }).strict() }).strict(),
  z.object({ skillId: z.literal('robot-make-plan'), arguments: makeRobotInputSchema }).strict(),
  z.object({ skillId: z.literal('robot-search-public'), arguments: z.object({ query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(10_000).default(0) }).strict() }).strict(),
  z.object({ skillId: z.literal('robot-get-public'), arguments: z.object({ owner: z.string().trim().min(1).max(80), slug }).strict() }).strict(),
]);

export async function executeRobotA2ASkill(locals: App.Locals, origin: string, parts: Array<{ text?: string; data?: unknown }>): Promise<A2AExecution> {
  let candidate: unknown;
  for (const part of parts) {
    if (part.data !== undefined) { candidate = part.data; break; }
    if (part.text) { try { candidate = JSON.parse(part.text); break; } catch { /* keep looking */ } }
  }
  const parsed = requestSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, status: 'input-required', message: `Send one supported Robot skill and valid arguments: ${parsed.error.issues[0]?.message ?? 'invalid request'}.` };
  const request = parsed.data;
  const discoverySql = sqlClient(locals);
  const record = async (type: string, key: string) => { if (discoverySql) await discoverySql`select app.record_robot_discovery('a2a',${type},${key})`.catch(() => undefined); };
  if (request.skillId === 'robot-search-components') { await record('catalog', 'components'); return { ok: true, skillId: request.skillId, output: { components: searchRobotComponents(request.arguments) } }; }
  if (request.skillId === 'robot-get-component') {
    await record('component', request.arguments.slug);
    const component = robotComponent(request.arguments.slug);
    return component ? { ok: true, skillId: request.skillId, output: { component } } : { ok: false, status: 'rejected', message: 'Robot component not found.' };
  }
  if (request.skillId === 'robot-check-compatibility') {
    const claims = componentCompatibility(request.arguments.left, request.arguments.right);
    return { ok: true, skillId: request.skillId, output: { state: claims.length ? 'recorded' : 'unknown', claims } };
  }
  if (request.skillId === 'robot-make-plan') { await record('planner', 'make-robot'); return { ok: true, skillId: request.skillId, output: { plan: makeRobotPlan(request.arguments) } }; }
  const sql = sqlClient(locals);
  if (!sql) return { ok: false, status: 'failed', message: 'Public Robot database unavailable.' };
  try {
    if (request.skillId === 'robot-search-public') {
      await record('catalog', 'public-robots');
      const robots = await listPublicRobots(sql, request.arguments);
      return { ok: true, skillId: request.skillId, output: { state: robots.length ? 'ok' : 'empty', robots: robots.map((row) => robotJson(row, origin)) } };
    }
    await record('robot', `${request.arguments.owner}/${request.arguments.slug}`);
    const robot = await getPublicRobot(sql, request.arguments.owner, request.arguments.slug);
    return robot ? { ok: true, skillId: request.skillId, output: { robot: robotJson(robot, origin) } } : { ok: false, status: 'rejected', message: 'Public Robot not found.' };
  } catch { return { ok: false, status: 'failed', message: 'Public Robot database unavailable.' }; }
}
