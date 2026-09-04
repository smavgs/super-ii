import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import {
  getNowPayment,
  isUsdcEthereumRoute,
  safeProviderPayload,
  validPaymentStatus,
} from '@/lib/nowpayments';

const openStatuses = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid']);

export const GET: APIRoute = async ({ locals, params }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const orderId = params.orderId ?? '';
  if (!UUID_PATTERN.test(orderId)) return Response.json({ error: 'checkout not found' }, { status: 404 });

  const loadOrder = () => sql`
    select payment.id, payment.product_type, payment.repository_id, payment.duration_days,
           payment.price_amount_cents, payment.pay_currency, payment.pay_network,
           payment.pay_amount, payment.pay_address, payment.status,
           payment.provider_payment_id, payment.expires_at, payment.paid_at,
           slot.slot_number, repository.owner_handle, repository.slug, repository.title
    from app.participation_orders payment
    left join app.fame_slots slot on slot.order_id = payment.id
    left join app.repositories repository on repository.id = payment.repository_id
    where payment.id = ${orderId}::uuid and payment.profile_id = ${profile.profileId}::uuid
    limit 1
  `;

  let rows = await loadOrder().catch(() => []);
  let order = rows[0];
  if (!order) return Response.json({ error: 'checkout not found' }, { status: 404 });
  if (order.provider_payment_id && openStatuses.has(String(order.status))) {
    try {
      const payment = await getNowPayment(locals, String(order.provider_payment_id));
      if (validPaymentStatus(payment.payment_status)
        && String(payment.payment_id) === String(order.provider_payment_id)
        && payment.order_id === `superii:participation:${orderId}`
        && payment.price_currency.toLowerCase() === 'usd'
        && Math.round(payment.price_amount * 100) === Number(order.price_amount_cents)
        && isUsdcEthereumRoute(payment)) {
        await sql`
          select app.apply_participation_payment_status(
            ${orderId}::uuid, ${String(payment.payment_id)}, ${payment.payment_status},
            ${JSON.stringify(safeProviderPayload(payment))}::jsonb
          )
        `;
        rows = await loadOrder();
        order = rows[0] ?? order;
      }
    } catch {
      // Signed IPN updates remain authoritative when provider polling is temporarily unavailable.
    }
  }
  return Response.json({ order }, {
    headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
};
