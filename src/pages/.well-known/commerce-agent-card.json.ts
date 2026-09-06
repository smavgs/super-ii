import type { APIRoute } from 'astro';

export const commerceAgentCard = {
  name: 'Super ii Commerce Agent',
  description: 'Discover every current Super ii offer, check exact eligibility, create bounded NOWPayments invoices for USDC on Ethereum, monitor signed confirmation, read immutable receipts, and request Enterprise proposals. A separate human-issued commerce token is required for every non-catalog action. Super ii never receives wallet keys or sends funds.',
  supportedInterfaces: [{
    url: 'https://superii.site/a2a/commerce/v1',
    protocolBinding: 'HTTP+JSON',
    protocolVersion: '1.0',
  }],
  provider: { organization: 'Super ii', url: 'https://superii.site' },
  iconUrl: 'https://superii.site/brand/super-ii-logo.png',
  version: '1.0.0',
  documentationUrl: 'https://superii.site/agents#commerce-lane',
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  defaultInputModes: ['application/json', 'text/plain'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: 'commerce-list-products',
      name: 'List Super ii products',
      description: 'Publicly return exact prices, targets, eligibility rules, settlement details, and machine endpoints.',
      tags: ['commerce', 'catalog', 'usdc', 'ethereum'],
      examples: ['{"skillId":"commerce-list-products","arguments":{}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
    {
      id: 'commerce-check-eligibility',
      name: 'Check delegated purchase eligibility',
      description: 'Requires Authorization: Bearer sii_commerce_<opaque>. Checks target authority, limits, seats, repository review state, and inventory.',
      tags: ['commerce', 'authorization', 'eligibility'],
      examples: ['{"skillId":"commerce-check-eligibility","arguments":{"product_id":"plan.pro.30d","unit_count":1}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
    {
      id: 'commerce-create-order',
      name: 'Create a USDC on Ethereum invoice',
      description: 'Requires a commerce bearer token and stable idempotency key. Creates an invoice only and never debits a wallet.',
      tags: ['commerce', 'nowpayments', 'usdc', 'ethereum'],
      examples: ['{"skillId":"commerce-create-order","arguments":{"idempotency_key":"purchase-20260905-0001","product_id":"plan.pro.30d","unit_count":1}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
    {
      id: 'commerce-get-order',
      name: 'Monitor payment and fulfillment',
      description: 'Requires the same delegation token. Returns exact payment status and a receipt only after confirmed fulfillment.',
      tags: ['commerce', 'payment-status', 'fulfillment'],
      examples: ['{"skillId":"commerce-get-order","arguments":{"order_id":"00000000-0000-4000-8000-000000000000"}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
    {
      id: 'commerce-get-receipt',
      name: 'Read immutable commerce receipt',
      description: 'Requires the creating delegation token. Returns the confirmed provider reference and evidence checksum.',
      tags: ['commerce', 'receipt', 'evidence'],
      examples: ['{"skillId":"commerce-get-receipt","arguments":{"receipt_id":"00000000-0000-4000-8000-000000000000"}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
    {
      id: 'commerce-request-enterprise-quote',
      name: 'Request an Enterprise proposal',
      description: 'Requires a delegation that explicitly allows enterprise.quote. Human review and exact pricing precede payment.',
      tags: ['commerce', 'enterprise', 'proposal'],
      examples: ['{"skillId":"commerce-request-enterprise-quote","arguments":{"idempotency_key":"enterprise-20260905-01","contact_name":"Operator","contact_email":"operator@example.com","organization_name":"Example","requirements":"Governed deployment for our organization."}}'],
      inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'],
    },
  ],
};

const body = JSON.stringify(commerceAgentCard, null, 2);

export const GET: APIRoute = async () => new Response(body, {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300, s-maxage=3600',
    etag: '"superii-commerce-agent-1.0.0"',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  },
});
