import { z } from 'zod';
import type { A2AExecution } from './a2a';
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

const orderArguments = z.object({
  product_id: z.enum([
    'plan.pro.30d', 'plan.pro.12m', 'plan.team.30d', 'plan.team.12m',
    'highlight.24h', 'highlight.30d', 'recognition.founding200',
  ]),
  organization_id: z.string().regex(UUID_PATTERN).optional(),
  repository_id: z.string().regex(UUID_PATTERN).optional(),
  unit_count: z.number().int().min(1).max(100).default(1),
}).strict();

const idempotentOrderArguments = orderArguments.extend({
  idempotency_key: z.string().trim().min(16).max(200),
}).strict();

const quoteArguments = z.object({
  idempotency_key: z.string().trim().min(16).max(200),
  contact_name: z.string().trim().min(2).max(100),
  contact_email: z.email().max(254),
  organization_name: z.string().trim().min(2).max(200),
  requirements: z.string().trim().min(10).max(3800),
}).strict();

const commerceSkillRequest = z.discriminatedUnion('skillId', [
  z.object({ skillId: z.literal('commerce-list-products'), arguments: z.object({}).strict().default({}) }).strict(),
  z.object({ skillId: z.literal('commerce-check-eligibility'), arguments: orderArguments }).strict(),
  z.object({ skillId: z.literal('commerce-create-order'), arguments: idempotentOrderArguments }).strict(),
  z.object({ skillId: z.literal('commerce-get-order'), arguments: z.object({ order_id: z.string().regex(UUID_PATTERN) }).strict() }).strict(),
  z.object({ skillId: z.literal('commerce-get-receipt'), arguments: z.object({ receipt_id: z.string().regex(UUID_PATTERN) }).strict() }).strict(),
  z.object({ skillId: z.literal('commerce-request-enterprise-quote'), arguments: quoteArguments }).strict(),
]);

type CommerceA2APart = { text?: string; data?: unknown };

function requestedSkill(parts: CommerceA2APart[]) {
  for (const part of parts) {
    if (part.data !== undefined) return commerceSkillRequest.safeParse(part.data);
    if (part.text) {
      try {
        return commerceSkillRequest.safeParse(JSON.parse(part.text));
      } catch {
        continue;
      }
    }
  }
  return null;
}

function failure(error: unknown): A2AExecution {
  const message = error instanceof Error ? error.message : 'Commerce operation failed.';
  const status = error && typeof error === 'object' && 'status' in error && Number(error.status) < 500
    ? 'rejected'
    : 'failed';
  return { ok: false, status, message };
}

export async function executeCommerceA2ASkill(
  locals: App.Locals,
  origin: string,
  request: Request,
  parts: CommerceA2APart[],
): Promise<A2AExecution> {
  const parsed = requestedSkill(parts);
  if (!parsed) {
    return { ok: false, status: 'input-required', message: 'Send one structured data part with skillId and arguments. Read /.well-known/commerce-agent-card.json.' };
  }
  if (!parsed.success) {
    return { ok: false, status: 'input-required', message: parsed.error.issues[0]?.message ?? 'Invalid commerce task.' };
  }
  const task = parsed.data;
  if (task.skillId === 'commerce-list-products') {
    return { ok: true, skillId: task.skillId, output: commerceCatalog(origin) };
  }
  const sql = sqlClient(locals);
  if (!sql) return { ok: false, status: 'failed', message: 'Commerce database unavailable.' };

  try {
    if (task.skillId === 'commerce-check-eligibility') {
      const input = commerceOrderInputSchema.parse(task.arguments);
      return { ok: true, skillId: task.skillId, output: await checkCommerceEligibility(request, sql, input) };
    }
    if (task.skillId === 'commerce-create-order') {
      if (!nowPaymentsConfigured(locals)) throw new Error('USDC checkout is not configured.');
      if (!validIdempotencyKey(task.arguments.idempotency_key)) throw new Error('Invalid idempotency key.');
      const { idempotency_key, ...rawOrder } = task.arguments;
      const input = commerceOrderInputSchema.parse(rawOrder);
      return { ok: true, skillId: task.skillId, output: await createCommerceOrder(locals, request, sql, idempotency_key, input) };
    }
    if (task.skillId === 'commerce-get-order') {
      return { ok: true, skillId: task.skillId, output: await getCommerceOrder(locals, request, sql, task.arguments.order_id) };
    }
    if (task.skillId === 'commerce-get-receipt') {
      return { ok: true, skillId: task.skillId, output: await getCommerceReceipt(request, sql, task.arguments.receipt_id) };
    }
    if (!validIdempotencyKey(task.arguments.idempotency_key)) throw new Error('Invalid idempotency key.');
    const networkHash = await requestNetworkHash(locals, request, 'commerce-a2a-quote');
    if (!networkHash) throw new Error('Commerce safety service unavailable.');
    const { idempotency_key, ...rawQuote } = task.arguments;
    const input = commerceQuoteInputSchema.parse(rawQuote);
    return {
      ok: true,
      skillId: task.skillId,
      output: await createCommerceQuoteRequest(request, sql, idempotency_key, input, networkHash),
    };
  } catch (error) {
    return failure(error);
  }
}
