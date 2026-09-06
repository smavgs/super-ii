import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  commerceProductIdSchema,
  commerceScopes,
  generateCommerceToken,
} from '@/lib/commerce';
import { UUID_PATTERN } from '@/lib/agent-management';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';
import { sha256Hex } from '@/lib/scoped-auth';

const optionalUuid = z.union([z.string().regex(UUID_PATTERN), z.null()]).optional();
const delegationSchema = z.object({
  agent_identity_id: optionalUuid,
  allowed_products: z.array(commerceProductIdSchema).min(1).max(8),
  organization_id: optionalUuid,
  repository_id: optionalUuid,
  max_order_amount_cents: z.number().int().min(1).max(100_000_000),
  total_limit_cents: z.number().int().min(1).max(100_000_000),
  max_orders: z.number().int().min(1).max(1000),
  expires_in_minutes: z.number().int().min(15).max(43_200),
}).strict().superRefine((value, context) => {
  if (value.organization_id && value.repository_id) {
    context.addIssue({ code: 'custom', message: 'Choose either an organization or repository boundary, not both.' });
  }
  if (value.max_order_amount_cents > value.total_limit_cents) {
    context.addIssue({ code: 'custom', path: ['total_limit_cents'], message: 'Total limit must cover the maximum per order.' });
  }
  if (new Set(value.allowed_products).size !== value.allowed_products.length) {
    context.addIssue({ code: 'custom', path: ['allowed_products'], message: 'Product IDs must be unique.' });
  }
});

const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export const GET: APIRoute = async ({ locals }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  try {
    const rows = await sql`
      select delegation.id, delegation.token_prefix, delegation.scopes,
             delegation.allowed_products, delegation.agent_identity_id,
             identity.handle as agent_handle,
             delegation.organization_id, organization.handle as organization_handle,
             delegation.repository_id, repository.owner_handle as repository_owner,
             repository.slug as repository_slug,
             delegation.max_order_amount_cents, delegation.total_limit_cents,
             delegation.authorized_amount_cents, delegation.max_orders,
             delegation.orders_created, delegation.expires_at,
             delegation.last_used_at, delegation.revoked_at, delegation.created_at
      from app.commerce_delegations delegation
      left join app.agent_identities identity on identity.id = delegation.agent_identity_id
      left join app.organizations organization on organization.id = delegation.organization_id
      left join app.repositories repository on repository.id = delegation.repository_id
      where delegation.profile_id = ${profile.profileId}::uuid
      order by delegation.created_at desc
      limit 100
    `;
    return Response.json({ delegations: rows }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'commerce delegations unavailable' }, { status: 503, headers: privateHeaders });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'commerce.delegation.create', 20, 86400);
  if (rate !== 'allowed') {
    return Response.json({
      error: rate === 'limited' ? 'commerce delegation creation limit reached' : 'safety service unavailable',
    }, { status: rate === 'limited' ? 429 : 503, headers: privateHeaders });
  }
  const body = await readBoundedJsonObject(request, 16_384);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: privateHeaders });
  const parsed = delegationSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid commerce delegation' }, { status: 422, headers: privateHeaders });
  }

  const token = generateCommerceToken();
  const tokenHash = await sha256Hex(token);
  const tokenPrefix = `sii_commerce_${token.slice('sii_commerce_'.length, 'sii_commerce_'.length + 8)}`;
  const expiresAt = new Date(Date.now() + parsed.data.expires_in_minutes * 60_000).toISOString();
  try {
    const rows = await sql`
      select * from app.create_commerce_delegation(
        ${profile.profileId}::uuid,
        ${parsed.data.agent_identity_id ?? null}::uuid,
        ${tokenPrefix}, ${tokenHash}, ${commerceScopes},
        ${parsed.data.allowed_products},
        ${parsed.data.organization_id ?? null}::uuid,
        ${parsed.data.repository_id ?? null}::uuid,
        ${parsed.data.max_order_amount_cents},
        ${parsed.data.total_limit_cents}, ${parsed.data.max_orders},
        ${expiresAt}::timestamptz
      )
    `;
    const metadata = rows[0];
    if (!metadata?.id) throw new Error('delegation not created');
    return Response.json({
      ok: true,
      token,
      warning: 'Copy this commerce token now. Super ii stores only its SHA-256 hash. It creates invoices but cannot access or debit a wallet.',
      endpoints: {
        catalog: '/api/commerce/catalog',
        eligibility: '/api/commerce/eligibility',
        orders: '/api/commerce/orders',
        mcp: '/mcp/commerce',
        a2a: '/.well-known/commerce-agent-card.json',
      },
      delegation: {
        id: metadata.id,
        token_prefix: metadata.token_prefix,
        scopes: metadata.scopes,
        allowed_products: metadata.allowed_products,
        organization_id: metadata.organization_id,
        repository_id: metadata.repository_id,
        max_order_amount_cents: metadata.max_order_amount_cents,
        total_limit_cents: metadata.total_limit_cents,
        max_orders: metadata.max_orders,
        expires_at: metadata.expires_at,
      },
    }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    const forbidden = detail.includes('operator_required');
    return Response.json({
      error: forbidden
        ? 'Selected agent, organization, or repository is outside your authority.'
        : 'Commerce delegation could not be created.',
    }, { status: forbidden ? 403 : 409, headers: privateHeaders });
  }
};
