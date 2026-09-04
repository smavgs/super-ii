import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { getNowPayment, isUsdcEthereumRoute, safeProviderPayload, validPaymentStatus } from '@/lib/nowpayments';

const openStatuses = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid']);

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const orderId = params.orderId ?? '';
  let rows = await sql`
    select id, plan_id, seat_count, billing_term, price_amount_cents, pay_currency, pay_network,
           pay_amount, pay_address, status, provider_payment_id, expires_at, paid_at, created_at
    from app.payment_orders
    where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
    limit 1
  `.catch(() => []);
  let order = rows[0];
  if (!order) return Response.json({ error: 'checkout not found' }, { status: 404 });

  if (order.provider_payment_id && openStatuses.has(String(order.status))) {
    try {
      const payment = await getNowPayment(locals, String(order.provider_payment_id));
      if (validPaymentStatus(payment.payment_status)
        && String(payment.payment_id) === String(order.provider_payment_id)
        && payment.order_id === `superii:${orderId}`
        && payment.price_currency.toLowerCase() === 'usd'
        && Math.round(payment.price_amount * 100) === Number(order.price_amount_cents)
        && isUsdcEthereumRoute(payment)) {
        await sql`
          select app.apply_nowpayments_status(
            ${orderId}::uuid,
            ${String(payment.payment_id)},
            ${payment.payment_status},
            ${JSON.stringify(safeProviderPayload(payment))}::jsonb
          )
        `;
        rows = await sql`
          select id, plan_id, seat_count, billing_term, price_amount_cents, pay_currency, pay_network,
                 pay_amount, pay_address, status, provider_payment_id, expires_at, paid_at, created_at
          from app.payment_orders
          where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
          limit 1
        `;
        order = rows[0] ?? order;
      }
    } catch {
      // IPN remains authoritative; a transient status lookup must not alter payment state.
    }
  }

  return Response.json({ order }, {
    headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
};
