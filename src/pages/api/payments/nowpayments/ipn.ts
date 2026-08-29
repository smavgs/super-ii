import type { APIRoute } from 'astro';
import { sqlClient } from '@/lib/db';
import {
  isUsdcEthereumRoute,
  safeProviderPayload,
  validPaymentStatus,
  verifyNowPaymentsIpn,
} from '@/lib/nowpayments';

export const POST: APIRoute = async ({ locals, request }) => {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return Response.json({ error: 'JSON required' }, { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ error: 'payload too large' }, { status: 413 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!await verifyNowPaymentsIpn(locals, payload, request.headers.get('x-nowpayments-sig'))) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  const providerPaymentId = payload.payment_id;
  const status = payload.payment_status;
  const externalOrder = typeof payload.order_id === 'string' ? payload.order_id : '';
  const orderId = externalOrder.startsWith('superii:') ? externalOrder.slice('superii:'.length) : '';
  const priceAmount = Number(payload.price_amount);
  if ((typeof providerPaymentId !== 'string' && typeof providerPaymentId !== 'number')
    || !validPaymentStatus(status)
    || !/^[0-9a-f-]{36}$/i.test(orderId)
    || !Number.isFinite(priceAmount)
    || typeof payload.price_currency !== 'string'
    || payload.price_currency.toLowerCase() !== 'usd'
    || !isUsdcEthereumRoute(payload)) {
    return Response.json({ error: 'invalid payment payload' }, { status: 400 });
  }
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  try {
    const orders = await sql`
      select price_amount_cents, price_currency, pay_currency, pay_network, provider_payment_id
      from app.payment_orders
      where id = ${orderId}::uuid and provider = 'nowpayments'
      limit 1
    `;
    const order = orders[0];
    if (!order
      || Number(order.price_amount_cents) !== Math.round(priceAmount * 100)
      || String(order.price_currency).toLowerCase() !== 'usd'
      || String(order.pay_currency).toLowerCase() !== 'usdc'
      || String(order.pay_network).toLowerCase() !== 'eth'
      || (order.provider_payment_id
        && String(order.provider_payment_id) !== String(providerPaymentId))) {
      return Response.json({ error: 'payment does not match checkout' }, { status: 409 });
    }
    const rows = await sql`
      select app.apply_nowpayments_status(
        ${orderId}::uuid,
        ${String(providerPaymentId)},
        ${status},
        ${JSON.stringify(safeProviderPayload(payload))}::jsonb
      ) as applied
    `;
    if (rows[0]?.applied !== true) throw new Error('payment update was not applied');
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'payment update failed' }, { status: 409 });
  }
};
