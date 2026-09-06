import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import {
  checkCommerceEligibility,
  commerceCatalog,
  commerceOrderInputSchema,
  commerceQuoteInputSchema,
  createCommerceOrder,
  createCommerceQuoteRequest,
  getCommerceOrder,
  getCommerceReceipt,
} from './commerce';
import { UUID_PATTERN } from './agent-management';
import { validIdempotencyKey } from './agent-auth';
import { sqlClient } from './db';
import { nowPaymentsConfigured } from './nowpayments';
import { requestNetworkHash } from './rate-limit';

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const idempotency = z.string().trim().min(16).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/)
  .describe('A stable key reused only when retrying this exact order or quote request.');
const uuid = z.string().regex(UUID_PATTERN);

const orderToolSchema = z.object({
  idempotency_key: idempotency,
  product_id: z.enum([
    'plan.pro.30d', 'plan.pro.12m', 'plan.team.30d', 'plan.team.12m',
    'highlight.24h', 'highlight.30d', 'recognition.founding200',
  ]),
  organization_id: uuid.optional(),
  repository_id: uuid.optional(),
  unit_count: z.number().int().min(1).max(100).default(1),
}).strict();

const eligibilityToolSchema = orderToolSchema.omit({ idempotency_key: true });

const quoteToolSchema = z.object({
  idempotency_key: idempotency,
  contact_name: z.string().trim().min(2).max(100),
  contact_email: z.email().max(254),
  organization_name: z.string().trim().min(2).max(200),
  requirements: z.string().trim().min(10).max(3800),
}).strict();

function toolError(error: unknown) {
  const value = error instanceof Error ? error : new Error('Commerce operation failed.');
  const code = 'code' in value && typeof value.code === 'string' ? value.code : 'commerce_unavailable';
  const status = 'status' in value && typeof value.status === 'number' ? value.status : 503;
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message: value.message, status }) }],
  };
}

function toolResult(value: unknown) {
  const rendered = JSON.stringify(value, null, 2);
  if (rendered.length > 240_000) return toolError(new Error('Bounded Commerce MCP response size exceeded.'));
  return { content: [{ type: 'text' as const, text: rendered }] };
}

export function createSuperiiCommerceMcpServer(
  locals: App.Locals,
  origin: string,
  request: Request,
): McpServer {
  const server = new McpServer(
    { name: 'Super ii Commerce MCP', version: '1.0.0' },
    {
      instructions: 'Use the public catalog first. All non-catalog tools require a separate sii_commerce_ bearer token issued by the human account owner. Creating an order creates a NOWPayments invoice only: it never debits a wallet. Pay only the exact USDC amount on Ethereum returned by the order, never claim payment yourself, and wait for status finished plus an immutable receipt before relying on fulfillment. Reuse an idempotency key only for an exact retry.',
    },
  );

  server.registerTool(
    'commerce_list_products',
    {
      title: 'List every Super ii offer available to agents',
      description: 'Return the canonical product, price, eligibility, target, settlement, and endpoint contract. No credential is required.',
      inputSchema: z.object({}).strict(),
      annotations: readAnnotations,
    },
    async () => toolResult(commerceCatalog(origin)),
  );

  server.registerTool(
    'commerce_check_eligibility',
    {
      title: 'Check one delegated purchase before creating an invoice',
      description: 'Check current product, target, seat, budget, ownership, and inventory rules. Order creation repeats every check atomically.',
      inputSchema: eligibilityToolSchema,
      annotations: readAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError(new Error('Commerce database unavailable.'));
      const parsed = commerceOrderInputSchema.safeParse(input);
      if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message ?? 'Invalid order.'));
      try {
        return toolResult(await checkCommerceEligibility(request, sql, parsed.data));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'commerce_create_order',
    {
      title: 'Create one bounded USDC on Ethereum invoice',
      description: 'Create an idempotent NOWPayments invoice for an allowed product and target. This tool does not access a wallet or transfer money.',
      inputSchema: orderToolSchema,
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError(new Error('Commerce database unavailable.'));
      if (!nowPaymentsConfigured(locals)) return toolError(new Error('USDC checkout is not configured.'));
      const { idempotency_key: _idempotencyKey, ...orderInput } = input;
      const parsed = commerceOrderInputSchema.safeParse(orderInput);
      if (!parsed.success || !validIdempotencyKey(input.idempotency_key)) {
        return toolError(new Error(parsed.success ? 'Invalid idempotency key.' : parsed.error.issues[0]?.message ?? 'Invalid order.'));
      }
      try {
        return toolResult(await createCommerceOrder(locals, request, sql, input.idempotency_key, parsed.data));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'commerce_get_order',
    {
      title: 'Read and refresh one delegated commerce order',
      description: 'Return exact payment instructions and current fulfillment state. Signed NOWPayments confirmation remains authoritative.',
      inputSchema: z.object({ order_id: uuid }).strict(),
      annotations: readAnnotations,
    },
    async ({ order_id }) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError(new Error('Commerce database unavailable.'));
      try {
        return toolResult(await getCommerceOrder(locals, request, sql, order_id));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'commerce_get_receipt',
    {
      title: 'Read an immutable confirmed-payment receipt',
      description: 'Return a hash-backed receipt visible only to the delegation that created the order.',
      inputSchema: z.object({ receipt_id: uuid }).strict(),
      annotations: readAnnotations,
    },
    async ({ receipt_id }) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError(new Error('Commerce database unavailable.'));
      try {
        return toolResult(await getCommerceReceipt(request, sql, receipt_id));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'commerce_request_enterprise_quote',
    {
      title: 'Request an exact Enterprise proposal',
      description: 'Submit bounded Enterprise requirements for human review. No payment is requested until Super ii approves and prices a proposal.',
      inputSchema: quoteToolSchema,
      annotations: writeAnnotations,
    },
    async (input) => {
      const sql = sqlClient(locals);
      if (!sql) return toolError(new Error('Commerce database unavailable.'));
      const { idempotency_key: _idempotencyKey, ...quoteInput } = input;
      const parsed = commerceQuoteInputSchema.safeParse(quoteInput);
      const networkHash = await requestNetworkHash(locals, request, 'commerce-mcp-quote');
      if (!parsed.success || !validIdempotencyKey(input.idempotency_key) || !networkHash) {
        return toolError(new Error(!networkHash ? 'Commerce safety service unavailable.' : parsed.success ? 'Invalid idempotency key.' : parsed.error.issues[0]?.message ?? 'Invalid quote request.'));
      }
      try {
        return toolResult(await createCommerceQuoteRequest(request, sql, input.idempotency_key, parsed.data, networkHash));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export function createSuperiiCommerceMcpHandler(
  locals: App.Locals,
  origin: string,
  request: Request,
) {
  return createMcpHandler(
    () => createSuperiiCommerceMcpServer(locals, origin, request),
    {
      route: '/mcp/commerce',
      legacy: 'stateless',
      corsOptions: {
        origin: 'https://superii.site',
        methods: 'GET, POST, DELETE, OPTIONS',
        headers: 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
        exposeHeaders: 'mcp-session-id',
        maxAge: 86400,
      },
      allowedHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
      allowedOriginHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
    },
  );
}
