import { runtimeValue } from './db';

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';

export const checkoutPlans = {
  pro: { name: 'Pro', unitAmountCents: 900, minimumSeats: 1, maximumSeats: 1 },
  team: { name: 'Team', unitAmountCents: 2000, minimumSeats: 1, maximumSeats: 100 },
} as const;

export type CheckoutPlanId = keyof typeof checkoutPlans;

export const checkoutTerms = {
  '30_days': { label: '30 days', discountPercent: 0 },
  '12_months': { label: '12 months', discountPercent: 20 },
} as const;

export type CheckoutTermId = keyof typeof checkoutTerms;

export type NowPayment = {
  payment_id: string | number;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  network?: string;
  order_id?: string;
  order_description?: string;
  expiration_estimate_date?: string;
  created_at?: string;
  updated_at?: string;
};

const allowedStatuses = new Set([
  'waiting',
  'confirming',
  'confirmed',
  'sending',
  'partially_paid',
  'finished',
  'failed',
  'refunded',
  'expired',
]);

const usdcEthereumNetworks = new Set(['eth', 'ethereum', 'erc20']);

export function isCheckoutPlan(value: unknown): value is CheckoutPlanId {
  return typeof value === 'string' && value in checkoutPlans;
}

export function isCheckoutTerm(value: unknown): value is CheckoutTermId {
  return typeof value === 'string' && value in checkoutTerms;
}

export function checkoutPriceCents(
  planId: CheckoutPlanId,
  seats: number,
  term: CheckoutTermId = '30_days',
): number {
  const monthlyTotal = checkoutPlans[planId].unitAmountCents * seats;
  return term === '12_months'
    ? Math.round(monthlyTotal * 12 * 0.8)
    : monthlyTotal;
}

export function validPaymentStatus(value: unknown): value is string {
  return typeof value === 'string' && allowedStatuses.has(value);
}

export function isUsdcEthereumRoute(value: { pay_currency?: unknown; network?: unknown }): boolean {
  if (typeof value.pay_currency !== 'string' || value.pay_currency.toLowerCase() !== 'usdc') {
    return false;
  }
  return value.network === undefined
    || value.network === null
    || (typeof value.network === 'string' && usdcEthereumNetworks.has(value.network.toLowerCase()));
}

function apiKey(locals: App.Locals): string | null {
  return runtimeValue(locals, 'NOWPAYMENTS_API_KEY')?.trim() || null;
}

export function nowPaymentsConfigured(locals: App.Locals): boolean {
  return Boolean(apiKey(locals) && runtimeValue(locals, 'NOWPAYMENTS_IPN_SECRET')?.trim());
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NOWPayments returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

function parsePayment(value: unknown): NowPayment {
  const payment = asObject(value);
  const parsed = {
    payment_id: payment.payment_id,
    payment_status: payment.payment_status,
    pay_address: payment.pay_address,
    price_amount: Number(payment.price_amount),
    price_currency: payment.price_currency,
    pay_amount: Number(payment.pay_amount),
    pay_currency: payment.pay_currency,
    network: payment.network,
    order_id: payment.order_id,
    order_description: payment.order_description,
    expiration_estimate_date: payment.expiration_estimate_date,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
  if ((typeof parsed.payment_id !== 'string' && typeof parsed.payment_id !== 'number')
    || typeof parsed.payment_status !== 'string'
    || typeof parsed.pay_address !== 'string'
    || !parsed.pay_address
    || !Number.isFinite(parsed.price_amount)
    || !Number.isFinite(parsed.pay_amount)
    || typeof parsed.price_currency !== 'string'
    || typeof parsed.pay_currency !== 'string') {
    throw new Error('NOWPayments returned an incomplete payment.');
  }
  return parsed as NowPayment;
}

async function requestNowPayments(
  locals: App.Locals,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const key = apiKey(locals);
  if (!key) throw new Error('NOWPayments is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${NOWPAYMENTS_API}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': key,
        ...init.headers,
      },
      signal: controller.signal,
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      const details = value && typeof value === 'object' && 'message' in value
        ? String((value as { message: unknown }).message)
        : `NOWPayments request failed with ${response.status}.`;
      throw new Error(details.slice(0, 500));
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export async function createNowPayment(
  locals: App.Locals,
  input: {
    orderId: string;
    planName: string;
    priceAmount: number;
    callbackUrl: string;
    orderReference?: string;
    description?: string;
  },
): Promise<NowPayment> {
  const orderReference = input.orderReference ?? `superii:${input.orderId}`;
  const result = await requestNowPayments(locals, '/payment', {
    method: 'POST',
    body: JSON.stringify({
      price_amount: input.priceAmount,
      price_currency: 'usd',
      pay_currency: 'usdc',
      ipn_callback_url: input.callbackUrl,
      order_id: orderReference,
      order_description: input.description ?? `Super ii ${input.planName} - 30 days`,
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
    }),
  });
  const payment = parsePayment(result);
  if (payment.price_currency.toLowerCase() !== 'usd'
    || Math.round(payment.price_amount * 100) !== Math.round(input.priceAmount * 100)
    || (payment.order_id !== undefined && payment.order_id !== orderReference)
    || !isUsdcEthereumRoute(payment)) {
    throw new Error('NOWPayments did not return the exact requested USDC on Ethereum checkout.');
  }
  return payment;
}

export async function getNowPayment(locals: App.Locals, paymentId: string): Promise<NowPayment> {
  return parsePayment(await requestNowPayments(locals, `/payment/${encodeURIComponent(paymentId)}`));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyNowPaymentsIpn(
  locals: App.Locals,
  payload: unknown,
  suppliedSignature: string | null,
): Promise<boolean> {
  const secret = runtimeValue(locals, 'NOWPAYMENTS_IPN_SECRET')?.trim();
  if (!secret || !suppliedSignature || !/^[a-f0-9]{128}$/i.test(suppliedSignature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(JSON.stringify(canonicalValue(payload))),
  );
  return constantTimeEqual(hex(signature), suppliedSignature.toLowerCase());
}

const safeProviderKeys = new Set([
  'payment_id',
  'payment_status',
  'pay_address',
  'price_amount',
  'price_currency',
  'pay_amount',
  'actually_paid',
  'outcome_amount',
  'pay_currency',
  'order_id',
  'order_description',
  'purchase_id',
  'network',
  'expiration_estimate_date',
  'created_at',
  'updated_at',
]);

export function safeProviderPayload(payload: unknown): Record<string, unknown> {
  const input = asObject(payload);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => safeProviderKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 4000) : value]),
  );
}
