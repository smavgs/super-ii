import type { NeonQueryFunction } from '@neondatabase/serverless';
import { z } from 'zod';
import { jsonSha256 } from './agent-auth';
import { UUID_PATTERN } from './agent-management';
import {
  createNowPayment,
  getNowPayment,
  isUsdcEthereumRoute,
  safeProviderPayload,
  validPaymentStatus,
} from './nowpayments';
import { sha256Hex } from './scoped-auth';
import { absoluteUrl } from './site';

export const commerceScopes = [
  'commerce:orders:create',
  'commerce:orders:read',
  'commerce:receipts:read',
] as const;

export type CommerceScope = (typeof commerceScopes)[number];

export const commerceProducts = [
  {
    id: 'plan.pro.30d',
    name: 'Super ii Pro · 30 days',
    kind: 'fixed' as const,
    target: 'profile' as const,
    unit: 'entitlement',
    unitAmountCents: 900,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Activates one personal Pro entitlement for 30 days after confirmed payment.',
  },
  {
    id: 'plan.pro.12m',
    name: 'Super ii Pro · 12 months',
    kind: 'fixed' as const,
    target: 'profile' as const,
    unit: 'entitlement',
    unitAmountCents: 8640,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Activates one personal Pro entitlement for 12 months after confirmed payment.',
  },
  {
    id: 'plan.team.30d',
    name: 'Super ii Team · 30 days',
    kind: 'per_unit' as const,
    target: 'organization' as const,
    unit: 'member',
    unitAmountCents: 2000,
    minimumUnits: 1,
    maximumUnits: 100,
    fulfillment: 'Activates Team for the selected organization and paid seat count for 30 days.',
  },
  {
    id: 'plan.team.12m',
    name: 'Super ii Team · 12 months',
    kind: 'per_unit' as const,
    target: 'organization' as const,
    unit: 'member',
    unitAmountCents: 19200,
    minimumUnits: 1,
    maximumUnits: 100,
    fulfillment: 'Activates Team for the selected organization and paid seat count for 12 months.',
  },
  {
    id: 'highlight.24h',
    name: 'Highlight · 24 hours',
    kind: 'fixed' as const,
    target: 'repository' as const,
    unit: 'campaign',
    unitAmountCents: 100,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Starts or schedules one labeled Highlight for an eligible reviewed public repository.',
  },
  {
    id: 'highlight.30d',
    name: 'Highlight · 30 days',
    kind: 'fixed' as const,
    target: 'repository' as const,
    unit: 'campaign',
    unitAmountCents: 1500,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Starts or schedules one labeled 30-day Highlight for an eligible reviewed public repository.',
  },
  {
    id: 'recognition.founding200',
    name: 'Founding 200',
    kind: 'fixed' as const,
    target: 'profile' as const,
    unit: 'place',
    unitAmountCents: 20000,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Reserves the next available permanent, non-transferable Founding 200 place for the account.',
  },
  {
    id: 'enterprise.quote',
    name: 'Enterprise proposal',
    kind: 'quote_required' as const,
    target: 'profile' as const,
    unit: 'proposal',
    unitAmountCents: null,
    minimumUnits: 1,
    maximumUnits: 1,
    fulfillment: 'Creates a reviewable Enterprise proposal request. Payment is available only after an exact proposal is approved.',
  },
] as const;

export type CommerceProduct = (typeof commerceProducts)[number];
export type CommerceProductId = CommerceProduct['id'];
export type FixedCommerceProductId = Exclude<CommerceProductId, 'enterprise.quote'>;

const productIds = commerceProducts.map((product) => product.id) as [CommerceProductId, ...CommerceProductId[]];
const fixedProductIds = commerceProducts
  .filter((product): product is Exclude<CommerceProduct, { id: 'enterprise.quote' }> => product.id !== 'enterprise.quote')
  .map((product) => product.id) as [FixedCommerceProductId, ...FixedCommerceProductId[]];

export const commerceProductIdSchema = z.enum(productIds);
export const fixedCommerceProductIdSchema = z.enum(fixedProductIds);

export const commerceOrderInputSchema = z.object({
  product_id: fixedCommerceProductIdSchema,
  organization_id: z.string().regex(UUID_PATTERN).optional(),
  repository_id: z.string().regex(UUID_PATTERN).optional(),
  unit_count: z.number().int().min(1).max(100).default(1),
}).strict().superRefine((input, context) => {
  const product = commerceProduct(input.product_id);
  if (product.target === 'organization' && !input.organization_id) {
    context.addIssue({ code: 'custom', path: ['organization_id'], message: 'organization_id is required for Team' });
  }
  if (product.target !== 'organization' && input.organization_id) {
    context.addIssue({ code: 'custom', path: ['organization_id'], message: 'organization_id is not accepted for this product' });
  }
  if (product.target === 'repository' && !input.repository_id) {
    context.addIssue({ code: 'custom', path: ['repository_id'], message: 'repository_id is required for Highlights' });
  }
  if (product.target !== 'repository' && input.repository_id) {
    context.addIssue({ code: 'custom', path: ['repository_id'], message: 'repository_id is not accepted for this product' });
  }
  if (input.unit_count < product.minimumUnits || input.unit_count > product.maximumUnits) {
    context.addIssue({
      code: 'custom',
      path: ['unit_count'],
      message: `unit_count must be ${product.minimumUnits}-${product.maximumUnits}`,
    });
  }
});

export const commerceQuoteInputSchema = z.object({
  contact_name: z.string().trim().min(2).max(100),
  contact_email: z.email().max(254),
  organization_name: z.string().trim().min(2).max(200),
  requirements: z.string().trim().min(10).max(3800),
}).strict();

export type CommerceOrderInput = z.infer<typeof commerceOrderInputSchema>;
export type CommerceQuoteInput = z.infer<typeof commerceQuoteInputSchema>;

export type CommerceActor = {
  delegationId: string;
  profileId: string;
  agentIdentityId: string | null;
  scopes: CommerceScope[];
  allowedProducts: CommerceProductId[];
  organizationId: string | null;
  repositoryId: string | null;
  maxOrderAmountCents: number;
  totalLimitCents: number;
  authorizedAmountCents: number;
  maxOrders: number;
  ordersCreated: number;
  expiresAt: string;
};

export type CommerceOrderRow = Record<string, unknown> & {
  id: string;
  delegation_id: string;
  profile_id: string;
  agent_identity_id: string | null;
  product_id: FixedCommerceProductId;
  order_type: 'plan' | 'participation';
  payment_order_id: string | null;
  participation_order_id: string | null;
  organization_id: string | null;
  repository_id: string | null;
  unit_count: number;
  price_amount_cents: number;
  provider_create_state: 'pending' | 'creating' | 'ready' | 'failed';
  provider_create_attempts: number;
};

export class CommerceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

const commerceTokenPattern = /^sii_commerce_[a-z0-9]{40,128}$/;
const openPaymentStatuses = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid']);

export function commerceProduct(productId: CommerceProductId): CommerceProduct {
  return commerceProducts.find((product) => product.id === productId) as CommerceProduct;
}

export function commercePriceCents(input: CommerceOrderInput): number {
  const product = commerceProduct(input.product_id);
  if (product.unitAmountCents === null) throw new CommerceError(422, 'quote_required', 'This product requires an approved quote.');
  return product.unitAmountCents * input.unit_count;
}

export function generateCommerceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sii_commerce_${secret}`;
}

export function commerceBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return commerceTokenPattern.test(token) ? token : null;
}

export async function commerceTokenHash(request: Request): Promise<string> {
  const authorization = request.headers.get('authorization');
  const token = commerceBearerToken(request);
  if (!authorization) throw new CommerceError(401, 'commerce_token_required', 'Commerce bearer token required.');
  if (!token) throw new CommerceError(401, 'commerce_token_invalid', 'Commerce bearer token is invalid.');
  return sha256Hex(token);
}

export function commerceCatalog(origin: string) {
  const absolute = (path: string) => new URL(path, origin).toString();
  return {
    schema_version: '1.0',
    name: 'Super ii Commerce',
    description: 'Agent-native checkout for every currently purchasable Super ii offer. Super ii creates orders and fulfills confirmed purchases; NOWPayments supplies the USDC invoice and confirms payment.',
    settlement: {
      provider: 'NOWPayments',
      price_currency: 'USD',
      pay_currency: 'USDC',
      network: 'Ethereum',
      network_code: 'eth',
      token_standard: 'ERC-20',
      wallet_custody: 'external',
      superii_holds_wallet_keys: false,
      automatic_wallet_debit: false,
    },
    authorization: {
      bearer_format: 'sii_commerce_<opaque>',
      issuance: absolute('/account#commerce'),
      scopes: commerceScopes,
      controls: ['allowed products', 'maximum per order', 'total authorized amount', 'maximum order count', 'expiry', 'optional organization or repository boundary', 'revocation'],
    },
    endpoints: {
      catalog: absolute('/api/commerce/catalog'),
      eligibility: absolute('/api/commerce/eligibility'),
      orders: absolute('/api/commerce/orders'),
      receipts: absolute('/api/commerce/receipts/{receipt_id}'),
      quote_requests: absolute('/api/commerce/quote-requests'),
      mcp: absolute('/mcp/commerce'),
      a2a_agent_card: absolute('/.well-known/commerce-agent-card.json'),
      openapi: absolute('/openapi.json'),
    },
    products: commerceProducts.map((product) => ({
      product_id: product.id,
      name: product.name,
      purchase_mode: product.kind === 'quote_required' ? 'quote_required' : 'fixed_nowpayments_invoice',
      target: product.target,
      pricing: product.unitAmountCents === null ? { currency: 'USD', amount: null }
        : {
            currency: 'USD',
            unit_amount_cents: product.unitAmountCents,
            unit: product.unit,
            minimum_units: product.minimumUnits,
            maximum_units: product.maximumUnits,
          },
      eligibility: product.target === 'organization'
        ? 'The token owner must be an owner or admin; seats cannot be below current membership.'
        : product.target === 'repository'
          ? 'The token owner must manage an eligible reviewed, published, public repository.'
          : product.id === 'recognition.founding200'
            ? 'The token owner must not already hold or have reserved a Founding 200 place; inventory must remain.'
            : 'The purchase is attached to the token owner profile.',
      fulfillment: product.fulfillment,
    })),
  };
}

function commerceFailure(error: unknown): CommerceError {
  if (error instanceof CommerceError) return error;
  const detail = error instanceof Error ? error.message : '';
  const mappings: Array<[string, CommerceError]> = [
    ['commerce_idempotency_conflict', new CommerceError(409, 'idempotency_conflict', 'The idempotency key was already used for a different request.')],
    ['commerce_delegation_limit_exceeded', new CommerceError(403, 'delegation_limit_exceeded', 'The order exceeds this delegation’s amount or order-count limit.')],
    ['commerce_product_not_delegated', new CommerceError(403, 'product_not_delegated', 'This product is not allowed by the commerce delegation.')],
    ['commerce_delegation_unauthorized', new CommerceError(403, 'commerce_token_forbidden', 'Commerce token is expired, revoked, or missing the required scope.')],
    ['commerce_quote_unauthorized', new CommerceError(403, 'commerce_quote_forbidden', 'Enterprise quote requests are not allowed by this delegation.')],
    ['commerce_repository_boundary_mismatch', new CommerceError(403, 'target_boundary_mismatch', 'Repository is outside this delegation’s boundary.')],
    ['commerce_organization_boundary_mismatch', new CommerceError(403, 'target_boundary_mismatch', 'Organization is outside this delegation’s boundary.')],
    ['organization_billing_access_required', new CommerceError(403, 'organization_access_required', 'Organization owner or admin billing access is required.')],
    ['reviewed_public_repository_ownership_required', new CommerceError(403, 'repository_ineligible', 'A managed, reviewed, published, public repository is required.')],
    ['insufficient_team_seats', new CommerceError(422, 'insufficient_team_seats', 'Seat count cannot be below current organization membership.')],
    ['fame_membership_already_assigned', new CommerceError(409, 'founding_place_already_assigned', 'This account already has or has reserved a Founding 200 place.')],
    ['fame_founders_closed', new CommerceError(409, 'founding_inventory_closed', 'No Founding 200 place is currently available.')],
    ['commerce_price_mismatch', new CommerceError(409, 'catalog_price_changed', 'The authoritative product price changed; reload the catalog and retry with a new key.')],
    ['commerce_personal_target_required', new CommerceError(422, 'invalid_target', 'This product requires the token owner’s personal profile target.')],
    ['commerce_team_organization_required', new CommerceError(422, 'invalid_target', 'Team requires one managed organization target.')],
    ['commerce_highlight_repository_required', new CommerceError(422, 'invalid_target', 'Highlight requires one eligible repository target.')],
    ['commerce_order_invalid', new CommerceError(422, 'invalid_order', 'Commerce order fields are invalid.')],
    ['commerce_quote_invalid', new CommerceError(422, 'invalid_quote_request', 'Enterprise quote fields are invalid.')],
    ['rate_limited', new CommerceError(429, 'quote_rate_limited', 'Please wait before submitting another Enterprise request.')],
  ];
  return mappings.find(([needle]) => detail.includes(needle))?.[1]
    ?? new CommerceError(503, 'commerce_unavailable', 'Commerce controls are temporarily unavailable.');
}

export async function authorizeCommerceToken(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  scope: CommerceScope,
): Promise<CommerceActor> {
  const tokenHash = await commerceTokenHash(request);
  try {
    const rows = await sql`
      select id, profile_id, agent_identity_id, scopes, allowed_products,
             organization_id, repository_id, max_order_amount_cents,
             total_limit_cents, authorized_amount_cents, max_orders,
             orders_created, expires_at
      from app.commerce_delegations
      where token_hash = ${tokenHash}
        and revoked_at is null and expires_at > now()
        and ${scope} = any(scopes)
      limit 1
    `;
    const row = rows[0];
    if (!row?.id) throw new CommerceError(403, 'commerce_token_forbidden', 'Commerce token is expired, revoked, or missing the required scope.');
    return {
      delegationId: String(row.id),
      profileId: String(row.profile_id),
      agentIdentityId: row.agent_identity_id ? String(row.agent_identity_id) : null,
      scopes: (Array.isArray(row.scopes) ? row.scopes : []) as CommerceScope[],
      allowedProducts: (Array.isArray(row.allowed_products) ? row.allowed_products : []) as CommerceProductId[],
      organizationId: row.organization_id ? String(row.organization_id) : null,
      repositoryId: row.repository_id ? String(row.repository_id) : null,
      maxOrderAmountCents: Number(row.max_order_amount_cents),
      totalLimitCents: Number(row.total_limit_cents),
      authorizedAmountCents: Number(row.authorized_amount_cents),
      maxOrders: Number(row.max_orders),
      ordersCreated: Number(row.orders_created),
      expiresAt: String(row.expires_at),
    };
  } catch (error) {
    if (error instanceof CommerceError) throw error;
    throw new CommerceError(503, 'commerce_auth_unavailable', 'Commerce authorization is temporarily unavailable.');
  }
}

function parseCommerceOrderRow(value: unknown): CommerceOrderRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommerceError(503, 'commerce_order_unavailable', 'Commerce order could not be loaded.');
  }
  const row = value as CommerceOrderRow;
  if (!UUID_PATTERN.test(String(row.id ?? '')) || !fixedProductIds.includes(row.product_id)) {
    throw new CommerceError(503, 'commerce_order_unavailable', 'Commerce order could not be loaded.');
  }
  return row;
}

async function loadCommerceOrder(
  sql: NeonQueryFunction<false, false>,
  orderId: string,
  delegationId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    select commerce.id, commerce.delegation_id, commerce.profile_id,
           commerce.agent_identity_id, commerce.product_id, commerce.order_type,
           commerce.organization_id, commerce.repository_id, commerce.unit_count,
           commerce.price_amount_cents, commerce.price_currency,
           commerce.pay_currency, commerce.pay_network,
           commerce.provider_create_state, commerce.provider_create_attempts,
           commerce.created_at, commerce.updated_at,
           coalesce(plan.status, participation.status) as payment_status,
           coalesce(plan.provider, participation.provider) as provider,
           coalesce(plan.provider_payment_id, participation.provider_payment_id) as provider_payment_id,
           coalesce(plan.pay_amount, participation.pay_amount) as pay_amount,
           coalesce(plan.pay_address, participation.pay_address) as pay_address,
           coalesce(plan.expires_at, participation.expires_at) as expires_at,
           coalesce(plan.paid_at, participation.paid_at) as paid_at,
           slot.slot_number, campaign.id as campaign_id,
           receipt.id as receipt_id, receipt.evidence_sha256,
           receipt.payment_finished_at
    from app.commerce_orders commerce
    left join app.payment_orders plan on plan.id = commerce.payment_order_id
    left join app.participation_orders participation
      on participation.id = commerce.participation_order_id
    left join app.fame_slots slot on slot.order_id = participation.id
    left join app.highlight_campaigns campaign on campaign.order_id = participation.id
    left join app.commerce_receipts receipt on receipt.commerce_order_id = commerce.id
    where commerce.id = ${orderId}::uuid
      and commerce.delegation_id = ${delegationId}::uuid
    limit 1
  `;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

function providerReference(order: CommerceOrderRow): string {
  const underlyingId = order.order_type === 'plan' ? order.payment_order_id : order.participation_order_id;
  return order.order_type === 'plan'
    ? `superii:${underlyingId}`
    : `superii:participation:${underlyingId}`;
}

function productDescription(order: CommerceOrderRow): string {
  const product = commerceProduct(order.product_id);
  return `Super ii ${product.name}${order.product_id.startsWith('plan.team.') ? ` - ${order.unit_count} seats` : ''}`;
}

async function ensureProviderCheckout(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  order: CommerceOrderRow,
): Promise<void> {
  const underlyingTable = order.order_type === 'plan' ? 'payment_orders' : 'participation_orders';
  const underlyingId = order.order_type === 'plan' ? order.payment_order_id : order.participation_order_id;
  if (!underlyingId) throw new CommerceError(503, 'commerce_order_unavailable', 'Commerce order has no payment record.');

  const existing = underlyingTable === 'payment_orders'
    ? await sql`select provider_payment_id from app.payment_orders where id = ${underlyingId}::uuid limit 1`
    : await sql`select provider_payment_id from app.participation_orders where id = ${underlyingId}::uuid limit 1`;
  if (existing[0]?.provider_payment_id) {
    await sql`
      update app.commerce_orders set provider_create_state = 'ready',
        provider_error_code = null, updated_at = now()
      where id = ${order.id}::uuid
    `;
    return;
  }

  const claimed = await sql`
    update app.commerce_orders set
      provider_create_state = 'creating',
      provider_create_attempts = provider_create_attempts + 1,
      provider_error_code = null,
      updated_at = now()
    where id = ${order.id}::uuid
      and (
        provider_create_state in ('pending', 'failed')
        or (provider_create_state = 'creating' and updated_at < now() - interval '2 minutes')
      )
      and provider_create_attempts < 3
    returning id
  `;
  if (!claimed.length) {
    const states = await sql`
      select provider_create_state, provider_create_attempts
      from app.commerce_orders where id = ${order.id}::uuid limit 1
    `;
    if (states[0]?.provider_create_state === 'creating'
      && Number(states[0]?.provider_create_attempts) < 3) {
      throw new CommerceError(409, 'checkout_creation_in_progress', 'The invoice is already being created; retry this exact request shortly.');
    }
    throw new CommerceError(502, 'checkout_creation_failed', 'The invoice could not be created after three bounded attempts.');
  }

  try {
    const payment = await createNowPayment(locals, {
      orderId: underlyingId,
      orderReference: providerReference(order),
      planName: commerceProduct(order.product_id).name,
      priceAmount: Number(order.price_amount_cents) / 100,
      callbackUrl: absoluteUrl('/api/payments/nowpayments/ipn'),
      description: productDescription(order),
    });
    if (!validPaymentStatus(payment.payment_status)) {
      throw new Error('unsupported payment status');
    }
    // Payment creation returns payment instructions, not authoritative
    // fulfillment. Terminal state is accepted only through the signed IPN or
    // the separately verified provider-status poll below.
    const initialStatus = openPaymentStatuses.has(payment.payment_status)
      ? payment.payment_status
      : 'waiting';
    const expiry = payment.expiration_estimate_date && !Number.isNaN(Date.parse(payment.expiration_estimate_date))
      ? new Date(payment.expiration_estimate_date).toISOString()
      : null;
    if (underlyingTable === 'payment_orders') {
      await sql`
        update app.payment_orders set
          provider_payment_id = coalesce(provider_payment_id, ${String(payment.payment_id)}),
          pay_amount = coalesce(pay_amount, ${payment.pay_amount}),
          pay_address = coalesce(pay_address, ${payment.pay_address}),
          status = case when provider_payment_id is null then ${initialStatus} else status end,
          expires_at = coalesce(expires_at, ${expiry}),
          provider_payload = case when provider_payment_id is null
            then ${JSON.stringify(safeProviderPayload(payment))}::jsonb
            else provider_payload end,
          updated_at = now()
        where id = ${underlyingId}::uuid
      `;
    } else {
      await sql`
        update app.participation_orders set
          provider_payment_id = coalesce(provider_payment_id, ${String(payment.payment_id)}),
          pay_amount = coalesce(pay_amount, ${payment.pay_amount}),
          pay_address = coalesce(pay_address, ${payment.pay_address}),
          status = case when provider_payment_id is null then ${initialStatus} else status end,
          expires_at = coalesce(expires_at, ${expiry}),
          provider_payload = case when provider_payment_id is null
            then ${JSON.stringify(safeProviderPayload(payment))}::jsonb
            else provider_payload end,
          updated_at = now()
        where id = ${underlyingId}::uuid
      `;
    }
    await sql`
      update app.commerce_orders set provider_create_state = 'ready',
        provider_error_code = null, updated_at = now()
      where id = ${order.id}::uuid
    `;
  } catch {
    await sql`
      update app.commerce_orders set provider_create_state = 'failed',
        provider_error_code = 'nowpayments_create_failed', updated_at = now()
      where id = ${order.id}::uuid and provider_create_state = 'creating'
    `.catch(() => []);
    throw new CommerceError(502, 'payment_provider_unavailable', 'NOWPayments could not create the USDC on Ethereum invoice. Retry the exact request with the same idempotency key.');
  }
}

export async function createCommerceOrder(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  idempotencyKey: string,
  input: CommerceOrderInput,
): Promise<Record<string, unknown>> {
  const tokenHash = await commerceTokenHash(request);
  const priceAmountCents = commercePriceCents(input);
  const requestSha256 = await jsonSha256({
    product_id: input.product_id,
    organization_id: input.organization_id ?? null,
    repository_id: input.repository_id ?? null,
    unit_count: input.unit_count,
    price_amount_cents: priceAmountCents,
  });
  try {
    const rows = await sql`
      select app.create_agent_commerce_order(
        ${tokenHash}, ${idempotencyKey}, ${requestSha256},
        ${input.product_id}, ${input.organization_id ?? null}::uuid,
        ${input.repository_id ?? null}::uuid, ${input.unit_count},
        ${priceAmountCents}
      ) as outcome
    `;
    const outcome = rows[0]?.outcome as Record<string, unknown> | undefined;
    const order = parseCommerceOrderRow(outcome?.order);
    await ensureProviderCheckout(locals, sql, order);
    const loaded = await loadCommerceOrder(sql, order.id, order.delegation_id);
    if (!loaded) throw new CommerceError(503, 'commerce_order_unavailable', 'Commerce order could not be loaded.');
    return commerceOrderDocument(loaded, new URL(request.url).origin, outcome?.replayed === true);
  } catch (error) {
    throw commerceFailure(error);
  }
}

async function pollProviderStatus(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
  row: Record<string, unknown>,
): Promise<void> {
  const paymentId = row.provider_payment_id ? String(row.provider_payment_id) : '';
  const status = String(row.payment_status ?? '');
  if (!paymentId || !openPaymentStatuses.has(status)) return;
  try {
    const payment = await getNowPayment(locals, paymentId);
    const underlyingId = row.order_type === 'plan' ? row.payment_order_id : row.participation_order_id;
    const expectedReference = row.order_type === 'plan'
      ? `superii:${underlyingId}`
      : `superii:participation:${underlyingId}`;
    if (!validPaymentStatus(payment.payment_status)
      || String(payment.payment_id) !== paymentId
      || payment.order_id !== expectedReference
      || payment.price_currency.toLowerCase() !== 'usd'
      || Math.round(payment.price_amount * 100) !== Number(row.price_amount_cents)
      || !isUsdcEthereumRoute(payment)) return;
    if (row.order_type === 'plan') {
      await sql`
        select app.apply_nowpayments_status(
          ${String(underlyingId)}::uuid, ${paymentId}, ${payment.payment_status},
          ${JSON.stringify(safeProviderPayload(payment))}::jsonb
        )
      `;
    } else {
      await sql`
        select app.apply_participation_payment_status(
          ${String(underlyingId)}::uuid, ${paymentId}, ${payment.payment_status},
          ${JSON.stringify(safeProviderPayload(payment))}::jsonb
        )
      `;
    }
  } catch {
    // The signed NOWPayments IPN remains authoritative during transient polling failure.
  }
}

export async function getCommerceOrder(
  locals: App.Locals,
  request: Request,
  sql: NeonQueryFunction<false, false>,
  orderId: string,
): Promise<Record<string, unknown>> {
  if (!UUID_PATTERN.test(orderId)) throw new CommerceError(404, 'order_not_found', 'Commerce order not found.');
  const actor = await authorizeCommerceToken(request, sql, 'commerce:orders:read');
  let row = await loadCommerceOrder(sql, orderId, actor.delegationId);
  if (!row) throw new CommerceError(404, 'order_not_found', 'Commerce order not found.');
  await pollProviderStatus(locals, sql, row);
  row = await loadCommerceOrder(sql, orderId, actor.delegationId) ?? row;
  return commerceOrderDocument(row, new URL(request.url).origin, true);
}

export function commerceOrderDocument(row: Record<string, unknown>, origin: string, replayed = false) {
  const orderId = String(row.id);
  const productId = String(row.product_id) as FixedCommerceProductId;
  const target = row.repository_id
    ? { type: 'repository', id: String(row.repository_id) }
    : row.organization_id
      ? { type: 'organization', id: String(row.organization_id) }
      : { type: 'profile', id: String(row.profile_id) };
  return {
    ok: true,
    replayed,
    order: {
      order_id: orderId,
      product_id: productId,
      product_name: commerceProduct(productId).name,
      target,
      unit_count: Number(row.unit_count),
      price: {
        amount_cents: Number(row.price_amount_cents),
        currency: 'USD',
      },
      payment: {
        provider: 'NOWPayments',
        status: String(row.payment_status ?? 'created'),
        asset: 'USDC',
        network: 'Ethereum',
        network_code: 'eth',
        token_standard: 'ERC-20',
        pay_amount: row.pay_amount === null || row.pay_amount === undefined ? null : String(row.pay_amount),
        pay_address: row.pay_address ? String(row.pay_address) : null,
        expires_at: row.expires_at ? String(row.expires_at) : null,
        confirmation_source: 'signed NOWPayments IPN; verified provider polling may refresh status',
      },
      fulfillment: {
        state: String(row.payment_status ?? 'created') === 'finished' ? 'fulfilled'
          : String(row.payment_status ?? '') === 'refunded' ? 'revoked'
            : 'pending_payment_confirmation',
        description: commerceProduct(productId).fulfillment,
        founding_slot: row.slot_number === null || row.slot_number === undefined ? null : Number(row.slot_number),
        highlight_campaign_id: row.campaign_id ? String(row.campaign_id) : null,
      },
      created_at: String(row.created_at),
      paid_at: row.paid_at ? String(row.paid_at) : null,
      receipt: row.receipt_id ? {
        receipt_id: String(row.receipt_id),
        evidence_sha256: String(row.evidence_sha256),
        payment_finished_at: String(row.payment_finished_at),
        href: new URL(`/api/commerce/receipts/${String(row.receipt_id)}`, origin).toString(),
      } : null,
      links: {
        self: new URL(`/api/commerce/orders/${orderId}`, origin).toString(),
        catalog: new URL('/api/commerce/catalog', origin).toString(),
      },
    },
  };
}

export async function getCommerceReceipt(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  receiptId: string,
): Promise<Record<string, unknown>> {
  if (!UUID_PATTERN.test(receiptId)) throw new CommerceError(404, 'receipt_not_found', 'Commerce receipt not found.');
  const actor = await authorizeCommerceToken(request, sql, 'commerce:receipts:read');
  try {
    const rows = await sql`
      select receipt.id, receipt.commerce_order_id, receipt.product_id,
             receipt.organization_id, receipt.repository_id, receipt.unit_count,
             receipt.price_amount_cents, receipt.price_currency,
             receipt.pay_currency, receipt.pay_network, receipt.provider,
             receipt.provider_payment_id, receipt.evidence_sha256,
             receipt.payment_finished_at, receipt.detail, receipt.created_at,
             commerce.profile_id
      from app.commerce_receipts receipt
      join app.commerce_orders commerce on commerce.id = receipt.commerce_order_id
      where receipt.id = ${receiptId}::uuid
        and receipt.delegation_id = ${actor.delegationId}::uuid
      limit 1
    `;
    const receipt = rows[0];
    if (!receipt) throw new CommerceError(404, 'receipt_not_found', 'Commerce receipt not found.');
    return {
      ok: true,
      receipt: {
        receipt_id: String(receipt.id),
        order_id: String(receipt.commerce_order_id),
        product_id: String(receipt.product_id),
        target: receipt.repository_id
          ? { type: 'repository', id: String(receipt.repository_id) }
          : receipt.organization_id
            ? { type: 'organization', id: String(receipt.organization_id) }
            : { type: 'profile', id: String(receipt.profile_id) },
        unit_count: Number(receipt.unit_count),
        price: { amount_cents: Number(receipt.price_amount_cents), currency: 'USD' },
        settlement: {
          provider: 'NOWPayments', asset: 'USDC', network: 'Ethereum',
          network_code: 'eth', token_standard: 'ERC-20',
          provider_payment_id: String(receipt.provider_payment_id),
        },
        evidence_sha256: String(receipt.evidence_sha256),
        payment_finished_at: String(receipt.payment_finished_at),
        created_at: String(receipt.created_at),
      },
    };
  } catch (error) {
    if (error instanceof CommerceError) throw error;
    throw new CommerceError(503, 'receipt_unavailable', 'Commerce receipt is temporarily unavailable.');
  }
}

export async function checkCommerceEligibility(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  input: CommerceOrderInput,
): Promise<Record<string, unknown>> {
  const actor = await authorizeCommerceToken(request, sql, 'commerce:orders:create');
  const priceAmountCents = commercePriceCents(input);
  const reasons: string[] = [];
  if (!actor.allowedProducts.includes(input.product_id)) reasons.push('product_not_delegated');
  if (priceAmountCents > actor.maxOrderAmountCents) reasons.push('maximum_per_order_exceeded');
  if (actor.authorizedAmountCents + priceAmountCents > actor.totalLimitCents) reasons.push('total_authorized_amount_exceeded');
  if (actor.ordersCreated >= actor.maxOrders) reasons.push('maximum_order_count_reached');
  if (actor.repositoryId && input.repository_id !== actor.repositoryId) reasons.push('repository_boundary_mismatch');
  if (actor.organizationId && input.organization_id && input.organization_id !== actor.organizationId) reasons.push('organization_boundary_mismatch');
  if (actor.organizationId && !input.organization_id && !input.repository_id) reasons.push('personal_product_outside_organization_boundary');

  try {
    if (input.product_id.startsWith('plan.team.')) {
      const rows = await sql`
        select count(member.profile_id)::integer as member_count
        from app.organization_members manager
        join app.organization_members member
          on member.organization_id = manager.organization_id
        where manager.organization_id = ${input.organization_id ?? null}::uuid
          and manager.profile_id = ${actor.profileId}::uuid
          and manager.role in ('owner', 'admin')
        group by manager.organization_id
      `;
      if (!rows.length) reasons.push('organization_owner_or_admin_required');
      else if (input.unit_count < Number(rows[0].member_count)) reasons.push('seat_count_below_current_membership');
    } else if (input.product_id.startsWith('highlight.')) {
      const rows = await sql`
        select repository.owner_organization_id
        from app.repositories repository
        join app.repository_branches branch
          on branch.repository_id = repository.id and branch.is_default
        join app.repository_revisions revision
          on revision.id = branch.head_revision_id and revision.status = 'published'
        where repository.id = ${input.repository_id ?? null}::uuid
          and repository.visibility = 'public' and repository.status = 'published'
          and (
            repository.owner_profile_id = ${actor.profileId}::uuid
            or exists (
              select 1 from app.organization_members member
              where member.organization_id = repository.owner_organization_id
                and member.profile_id = ${actor.profileId}::uuid
                and member.role in ('owner', 'admin', 'maintainer')
            )
          )
      `;
      if (!rows.length) reasons.push('reviewed_public_repository_ownership_required');
      else if (actor.organizationId && String(rows[0].owner_organization_id ?? '') !== actor.organizationId) {
        reasons.push('organization_boundary_mismatch');
      }
    } else if (input.product_id === 'recognition.founding200') {
      const rows = await sql`
        select
          exists (select 1 from app.fame_slots where profile_id = ${actor.profileId}::uuid
            and status in ('reserved', 'active', 'retired')) as already_assigned,
          exists (select 1 from app.fame_slots where status = 'open') as inventory_available
      `;
      if (rows[0]?.already_assigned === true) reasons.push('founding_place_already_assigned');
      if (rows[0]?.inventory_available !== true) reasons.push('founding_inventory_closed');
    }
  } catch {
    throw new CommerceError(503, 'eligibility_unavailable', 'Authoritative eligibility checks are temporarily unavailable.');
  }
  return {
    ok: true,
    eligibility: {
      eligible: reasons.length === 0,
      product_id: input.product_id,
      target: input.repository_id
        ? { type: 'repository', id: input.repository_id }
        : input.organization_id
          ? { type: 'organization', id: input.organization_id }
          : { type: 'profile', id: actor.profileId },
      unit_count: input.unit_count,
      price: { amount_cents: priceAmountCents, currency: 'USD' },
      reasons,
      authoritative_at_order_creation: true,
    },
  };
}

export async function createCommerceQuoteRequest(
  request: Request,
  sql: NeonQueryFunction<false, false>,
  idempotencyKey: string,
  input: CommerceQuoteInput,
  networkHash: string,
): Promise<Record<string, unknown>> {
  const tokenHash = await commerceTokenHash(request);
  const requestSha256 = await jsonSha256(input);
  try {
    const rows = await sql`
      select app.create_commerce_quote_request(
        ${tokenHash}, ${idempotencyKey}, ${requestSha256},
        ${input.contact_name}, ${input.contact_email},
        ${input.organization_name}, ${input.requirements},
        ${networkHash}, ${(request.headers.get('user-agent') ?? '').slice(0, 500)}
      ) as outcome
    `;
    const outcome = rows[0]?.outcome as Record<string, unknown> | undefined;
    const quote = outcome?.quote_request as Record<string, unknown> | undefined;
    if (!quote?.id) throw new CommerceError(503, 'quote_unavailable', 'Enterprise quote request could not be stored.');
    return {
      ok: true,
      replayed: outcome?.replayed === true,
      quote_request: {
        quote_request_id: String(quote.id),
        product_id: 'enterprise.quote',
        status: String(quote.status ?? 'new'),
        organization_name: String(quote.organization_name),
        created_at: String(quote.created_at),
        next_step: 'Super ii reviews the requirements and returns an exact proposal before any USDC payment is requested.',
      },
    };
  } catch (error) {
    throw commerceFailure(error);
  }
}

export function commerceErrorResponse(error: unknown): Response {
  const failure = commerceFailure(error);
  return Response.json({ error: failure.code, message: failure.message }, {
    status: failure.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/problem+json; charset=utf-8',
      ...(failure.status === 401 ? { 'www-authenticate': 'Bearer realm="Super ii Commerce"' } : {}),
    },
  });
}
