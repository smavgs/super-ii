import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import {
  checkoutPlans,
  checkoutPriceCents,
  createNowPayment,
  isCheckoutPlan,
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
  const rateLimit = await consumeRateLimit(locals, request, sql, 'checkout.create', 10, 3600);
  if (rateLimit !== 'allowed') {
    return Response.json(
      { error: rateLimit === 'limited' ? 'checkout rate limit reached' : 'safety service unavailable' },
      { status: rateLimit === 'limited' ? 429 : 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!isCheckoutPlan(body.plan_id)) return Response.json({ error: 'invalid plan' }, { status: 400 });
  const plan = checkoutPlans[body.plan_id];
  const requestedSeats = body.plan_id === 'pro' ? 1 : Number(body.seat_count ?? 1);
  const organizationId = body.plan_id === 'team' ? textValue(body.organization_id, 36) : null;
  if (!Number.isInteger(requestedSeats)
    || requestedSeats < plan.minimumSeats
    || requestedSeats > plan.maximumSeats) {
    return Response.json({ error: `seat count must be ${plan.minimumSeats}-${plan.maximumSeats}` }, { status: 400 });
  }
  if (body.plan_id === 'team') {
    if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      return Response.json({ error: 'select an organization for Team' }, { status: 422 });
    }
    const organizations = await sql`
      select count(member.profile_id)::integer as member_count
      from app.organization_members manager
      join app.organizations organization on organization.id = manager.organization_id
      left join app.organization_members member on member.organization_id = organization.id
      where organization.id = ${organizationId}::uuid
        and manager.profile_id = ${profile.profileId}::uuid
        and manager.role in ('owner', 'admin')
      group by organization.id
    `;
    if (!organizations.length) return Response.json({ error: 'organization billing access required' }, { status: 403 });
    if (requestedSeats < Number(organizations[0].member_count)) {
      return Response.json({ error: 'seat count cannot be lower than the current member count' }, { status: 422 });
    }
  }
  const priceCents = checkoutPriceCents(body.plan_id, requestedSeats);

  try {
    const orderRows = await sql`
      select * from app.create_or_reuse_payment_order(
        ${profile.profileId}::uuid,
        ${organizationId}::uuid,
        ${body.plan_id},
        ${requestedSeats},
        ${priceCents}
      )
    `;
    const order = orderRows[0];
    if (!order) throw new Error('payment order could not be created');
    const orderId = String(order.id);
    if (order.provider_payment_id) {
      return Response.json({ order_id: orderId, href: `/checkout/${orderId}`, reused: true });
    }
    if (order.provider_payload && typeof order.provider_payload === 'object'
      && 'create_attempted_at' in order.provider_payload) {
      return Response.json(
        { error: 'This checkout is already being created. Refresh your account before trying again.' },
        { status: 409 },
      );
    }
    const claimed = await sql`
      update app.payment_orders
      set provider_payload = jsonb_build_object('create_attempted_at', now()), updated_at = now()
      where id = ${orderId}::uuid and provider_payment_id is null
        and not (provider_payload ? 'create_attempted_at')
      returning id
    `;
    if (!claimed.length) {
      return Response.json({ error: 'This checkout is already being created.' }, { status: 409 });
    }

    const payment = await createNowPayment(locals, {
      orderId,
      planName: plan.name,
      priceAmount: priceCents / 100,
      callbackUrl: absoluteUrl('/api/payments/nowpayments/ipn'),
    });
    if (!validPaymentStatus(payment.payment_status)) {
      throw new Error('NOWPayments returned an unsupported payment status.');
    }
    const expiry = payment.expiration_estimate_date && !Number.isNaN(Date.parse(payment.expiration_estimate_date))
      ? new Date(payment.expiration_estimate_date).toISOString()
      : null;
    await sql`
      update app.payment_orders
      set provider_payment_id = ${String(payment.payment_id)},
          pay_amount = ${payment.pay_amount},
          pay_address = ${payment.pay_address},
          status = ${payment.payment_status},
          expires_at = ${expiry},
          provider_payload = ${JSON.stringify(safeProviderPayload(payment))}::jsonb,
          updated_at = now()
      where id = ${orderId}::uuid and profile_id = ${profile.profileId}::uuid
    `;
    return Response.json({ order_id: orderId, href: `/checkout/${orderId}`, reused: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'USDC checkout could not be created.';
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
};
