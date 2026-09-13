import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { authorizeAgentToken, existingAgentReceipt, jsonSha256, recordAgentReceipt } from './agent-auth';
import { sqlClient } from './db';
import { checkHuggingFaceTransparency, transparencyCheckInputSchema } from './transparent';
import {
  compareStoredTransparencyReports,
  getTransparencyReport,
  persistTransparencyReport,
  searchTransparencyReports,
  setTransparencyWatched,
} from './transparent-store';

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const checkAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const reportKey = z.string().regex(/^[a-f0-9]{64}$/);
const idempotency = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/);

function result(value: unknown) {
  const rendered = JSON.stringify(value, null, 2);
  if (rendered.length > 240_000) return error('bounded Transparent MCP response size exceeded');
  return { content: [{ type: 'text' as const, text: rendered }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
}

export function createSuperiiTransparentMcpServer(locals: App.Locals, origin: string, request: Request): McpServer {
  const server = new McpServer(
    { name: 'Super ii Transparent MCP', version: '1.0.0' },
    {
      instructions: 'Hugging Face public evidence only. Preserve the exact revision, criteria version, sources, checked date, and four evidence states. Verified means directly observed—not safe, true, lawful, or endorsed. Declared is a creator/provider statement. Derived always includes its method. Unknown must remain unknown. Never execute repository code or model weights.',
    },
  );

  server.registerResource(
    'super-ii-transparent-guide', `${origin}/transparent/agents.md`,
    { title: 'Super ii Transparent machine guide', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `Read the canonical guide at ${uri.href}` }] }),
  );

  server.registerTool('check_huggingface_transparency', {
    title: 'Check Hugging Face transparency',
    description: 'Inspect bounded public evidence for one Hugging Face model, dataset, or Space; resolve it to an exact commit; and create or reuse a permanent report.',
    inputSchema: transparencyCheckInputSchema,
    annotations: checkAnnotations,
  }, async (input) => {
    const sql = sqlClient(locals);
    if (!sql) return error('Transparency report database unavailable');
    try {
      const checked = await checkHuggingFaceTransparency(input);
      const stored = await persistTransparencyReport(sql, checked);
      await sql`select app.record_transparency_discovery('mcp','check',${stored.report.repository.id})`.catch(() => undefined);
      return result({ created: stored.created, report_url: new URL(`/transparent/${stored.report.report_key}`, origin).toString(), report: stored.report });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : 'Transparency Check unavailable');
    }
  });

  server.registerTool('get_transparency_report', {
    title: 'Get a transparency report',
    description: 'Return one permanent exact-revision report, direct evidence sources, and any verified creator response.',
    inputSchema: z.object({ report_key: reportKey }).strict(), annotations: readAnnotations,
  }, async ({ report_key }) => {
    const sql = sqlClient(locals);
    if (!sql) return error('Transparency report database unavailable');
    try {
      const report = await getTransparencyReport(sql, report_key);
      if (!report) return error('Transparency report not found');
      await sql`select app.record_transparency_discovery('mcp','read',${report.repository.id})`.catch(() => undefined);
      return result({ report });
    } catch { return error('Transparency report unavailable'); }
  });

  server.registerTool('compare_huggingface_revisions', {
    title: 'Compare two transparency reports',
    description: 'Compare evidence state, value, source, and method changes between two exact revisions of the same Hugging Face repository.',
    inputSchema: z.object({ left_report_key: reportKey, right_report_key: reportKey }).strict(), annotations: readAnnotations,
  }, async ({ left_report_key, right_report_key }) => {
    const sql = sqlClient(locals);
    if (!sql) return error('Transparency report database unavailable');
    try {
      const comparison = await compareStoredTransparencyReports(sql, left_report_key, right_report_key);
      if (!comparison) return error('Transparency report not found');
      await sql`select app.record_transparency_discovery('mcp','compare',${comparison.repository})`.catch(() => undefined);
      return result({ comparison });
    } catch (caught) { return error(caught instanceof Error ? caught.message : 'Comparison unavailable'); }
  });

  server.registerTool('search_public_transparency_reports', {
    title: 'Search public transparency reports',
    description: 'Search permanent reports by Hugging Face repository ID and optional artifact type. Empty results are real.',
    inputSchema: z.object({
      query: z.string().trim().max(120).optional(),
      kind: z.enum(['model', 'dataset', 'space']).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(10_000).default(0),
    }).strict(), annotations: readAnnotations,
  }, async (input) => {
    const sql = sqlClient(locals);
    if (!sql) return error('Transparency report database unavailable');
    try {
      const reports = await searchTransparencyReports(sql, input);
      await sql`select app.record_transparency_discovery('mcp','search',${input.query || input.kind || 'recent'})`.catch(() => undefined);
      return result({ state: reports.length ? 'ok' : 'empty', count: reports.length, reports });
    } catch { return error('Transparency report search unavailable'); }
  });

  server.registerTool('watch_transparency_report', {
    title: 'Watch a transparency report',
    description: 'Use a human-issued Super ii agent token with transparent:watch scope to add or remove an exact report from the operator’s Workspace watchlist.',
    inputSchema: z.object({ report_key: reportKey, watched: z.boolean().default(true), idempotency_key: idempotency }).strict(),
    annotations: writeAnnotations,
  }, async (input) => {
    const sql = sqlClient(locals);
    if (!sql) return error('Transparency report database unavailable');
    const authorization = await authorizeAgentToken(request, sql, 'transparent:watch');
    if (!authorization.ok) return error(authorization.error);
    const requestHash = await jsonSha256(input);
    try {
      const previous = await existingAgentReceipt(sql, authorization.actor, input.idempotency_key, 'transparency.watch', requestHash);
      if (previous.conflict) return error('idempotency key conflicts with an earlier action');
      if (previous.receipt) return result({ ...previous.receipt.detail, receipt: previous.receipt, replayed: true });
      const reports = await sql`select id from app.transparency_reports where report_key = ${input.report_key} limit 1`;
      if (!reports[0]?.id) return error('Transparency report not found');
      const updated = await setTransparencyWatched(sql, authorization.actor.profileId, input.report_key, input.watched);
      if (!updated) return error('Transparency report not found');
      const detail = { ok: true, watched: input.watched, report_key: input.report_key, report_url: new URL(`/transparent/${input.report_key}`, origin).toString() };
      const receipt = await recordAgentReceipt(sql, authorization.actor, {
        idempotencyKey: input.idempotency_key,
        action: 'transparency.watch',
        targetType: 'transparency_report',
        targetId: String(reports[0].id),
        targetRef: input.report_key,
        requestedScopes: ['transparent:watch'],
        requestSha256: requestHash,
        resultSha256: await jsonSha256(detail),
        status: 'succeeded',
        reviewBoundary: 'not-applicable',
        detail,
      });
      await sql`select app.record_transparency_discovery('mcp','watch',${input.report_key})`.catch(() => undefined);
      return result({ ...detail, receipt, replayed: false });
    } catch { return error('Transparency watch could not be changed'); }
  });

  return server;
}

export function createSuperiiTransparentMcpHandler(locals: App.Locals, origin: string, request: Request) {
  return createMcpHandler(() => createSuperiiTransparentMcpServer(locals, origin, request), {
    route: '/mcp/transparent', legacy: 'stateless',
    corsOptions: { origin: '*', methods: 'GET, POST, DELETE, OPTIONS', headers: 'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id', exposeHeaders: 'mcp-session-id', maxAge: 86_400 },
    allowedHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
    allowedOriginHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
  });
}
