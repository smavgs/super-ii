import type { APIRoute } from 'astro';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import {
  createNowPayment,
  nowPaymentsConfigured,
  safeProviderPayload,
  validPaymentStatus,
} from '@/lib/nowpayments';
import { consumeRateLimit } from '@/lib/rate-limit';
import { absoluteUrl } from '@/lib/site';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  if (!nowPaymentsConfigured(locals)) {
    return Response.json({ error: 'USDC checkout is not configured yet' }, { status: 503 });
  }
  const rate = await consumeRateLimit(locals, request, sql, 'participation.checkout', 10, 3600);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'checkout rate limit reached' : 'safety service unavailable' }, {
      status: rate === 'limited' ? 429 : 503,
    });
  }
  const parsed = await readBoundedJsonObject(request, 4096);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const product = textValue(parsed.value.product, 20);
  if (!['fame', 'highlight'].includes(product)) {
    return Response.json({ error: 'product must be fame or highlight' }, { status: 422 });
  }

  let orderId = '';
  try {
    if (product === 'fame') {
      const rows = await sql`select * from app.create_fame_checkout(${profile.profileId}::uuid)`;
      orderId = rows[0]?.order_id ? String(rows[0].order_id) : '';
    } else {
      const repositoryId = textValue(parsed.value.repository_id, 36);
      const durationDays = Number(parsed.value.duration_days);
      if (!UUID_PATTERN.test(repositoryId) || ![1, 30].includes(durationDays)) {
        return Response.json({ error: 'reviewed repository and 1- or 30-day duration required' }, { status: 422 });
      }
      const rows = await sql`
        select * from app.create_highlight_checkout(
          ${profile.profileId}::uuid, ${repositoryId}::uuid, ${durationDays}
        )
      `;
      orderId = rows[0]?.order_id ? String(rows[0].order_id) : '';
    }
    if (!orderId) throw new Error('participation order could not be created');

    const orderRows = await sql`
      select id, product_type, duration_days, price_amount_cents,
             provider_payment_id, provider_payload
      from app.participation_orders
      where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
      limit 1
    `;
    const order = orderRows[0];
    if (!order) throw new Error('participation order could not be loaded');
    const href = `/checkout/participation/${orderId}`;
    if (order.provider_payment_id) {
      return Response.json({ order_id: orderId, href, reused: true });
    }
    if (order.provider_payload && typeof order.provider_payload === 'object'
      && 'create_attempted_at' in order.provider_payload) {
      return Response.json({ error: 'This checkout is already being created. Please refresh shortly.' }, { status: 409 });
    }
    const claimed = await sql`
      update app.participation_orders
      set provider_payload = jsonb_build_object('create_attempted_at', now()), updated_at = now()
      where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
        and provider_payment_id is null and not (provider_payload ? 'create_attempted_at')
      returning id
    `;
    if (!claimed.length) return Response.json({ error: 'This checkout is already being created.' }, { status: 409 });

    const priceCents = Number(order.price_amount_cents);
    const isFame = String(order.product_type) === 'fame';
    const duration = Number(order.duration_days ?? 0);
    const payment = await createNowPayment(locals, {
      orderId,
      planName: isFame ? 'Founding 200' : 'Highlight',
      priceAmount: priceCents / 100,
      callbackUrl: absoluteUrl('/api/payments/nowpayments/ipn'),
      orderReference: `superii:participation:${orderId}`,
      description: isFame
        ? 'Super ii Founding 200 - one permanent Hall of Fame place'
        : `Super ii Highlight - ${duration === 1 ? '24 hours' : '30 days'}`,
    });
    if (!validPaymentStatus(payment.payment_status)) {
      throw new Error('NOWPayments returned an unsupported payment status.');
    }
    const expiry = payment.expiration_estimate_date && !Number.isNaN(Date.parse(payment.expiration_estimate_date))
      ? new Date(payment.expiration_estimate_date).toISOString()
      : null;
    await sql`
      update app.participation_orders
      set provider_payment_id = ${String(payment.payment_id)}, pay_amount = ${payment.pay_amount},
          pay_address = ${payment.pay_address}, status = ${payment.payment_status},
          expires_at = ${expiry},
          provider_payload = ${JSON.stringify(safeProviderPayload(payment))}::jsonb,
          updated_at = now()
      where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
    `;
    return Response.json({ order_id: orderId, href, reused: false }, { status: 201 });
  } catch (error) {
    if (orderId) {
      await sql`
        update app.participation_orders set status = 'failed', updated_at = now()
        where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
          and provider_payment_id is null
      `.catch(() => []);
      await sql`
        update app.fame_slots set profile_id = null, order_id = null, status = 'open',
               reserved_until = null, updated_at = now()
        where order_id = ${orderId}::uuid and status = 'reserved'
      `.catch(() => []);
      await sql`
        update app.highlight_campaigns set state = 'canceled', updated_at = now()
        where order_id = ${orderId}::uuid and state = 'pending'
      `.catch(() => []);
    }
    const message = error instanceof Error ? error.message : 'USDC checkout could not be created.';
    const status = message.includes('closed') ? 409 : message.includes('required') ? 403 : 502;
    return Response.json({ error: message.slice(0, 500) }, { status });
  }
};
