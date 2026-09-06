#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  migration: 'database/migrations/0016_agent_commerce.sql',
  smoke: 'database/tests/commerce_smoke.sql',
  commerce: 'src/lib/commerce.ts',
  http: 'src/lib/commerce-http.ts',
  mcp: 'src/lib/commerce-mcp-server.ts',
  mcpRoute: 'src/pages/mcp/commerce.ts',
  a2a: 'src/lib/commerce-a2a.ts',
  a2aRoute: 'src/pages/a2a/commerce/v1/[...operation].ts',
  card: 'src/pages/.well-known/commerce-agent-card.json.ts',
  wellKnown: 'src/pages/.well-known/commerce.json.ts',
  catalogApi: 'src/pages/api/commerce/catalog.ts',
  eligibilityApi: 'src/pages/api/commerce/eligibility.ts',
  ordersApi: 'src/pages/api/commerce/orders/index.ts',
  orderApi: 'src/pages/api/commerce/orders/[orderId].ts',
  receiptApi: 'src/pages/api/commerce/receipts/[receiptId].ts',
  quoteApi: 'src/pages/api/commerce/quote-requests.ts',
  delegationApi: 'src/pages/api/commerce/delegations/index.ts',
  revokeApi: 'src/pages/api/commerce/delegations/[delegationId].ts',
  workspace: 'src/components/CommerceWorkspace.astro',
  account: 'src/pages/account.astro',
  workMcp: 'src/lib/work-mcp-server.ts',
  ipn: 'src/pages/api/payments/nowpayments/ipn.ts',
  provider: 'src/lib/nowpayments.ts',
  schema: 'src/lib/schema.ts',
  openapi: 'src/pages/openapi.json.ts',
  agents: 'src/pages/agents.astro',
  agentContract: 'src/pages/agents.md.ts',
  handoff: 'src/pages/siiwebskill.md.ts',
  fullGuide: 'src/pages/llms-full.txt.ts',
  docs: 'src/pages/docs.astro',
  security: 'src/pages/security.astro',
  privacy: 'src/pages/legal/privacy.astro',
  terms: 'src/pages/legal/terms.astro',
  docsIndex: 'src/pages/docs.json.ts',
  state: 'SYSTEM-STATE.md',
  routes: 'src/content/site.json',
  testRunner: 'scripts/test-postgres.sh',
};

const files = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')]),
));
const errors = [];
const requireText = (file, text) => {
  if (!files[file].includes(text)) errors.push(`${paths[file]} is missing: ${text}`);
};

for (const table of ['commerce_delegations', 'commerce_orders', 'commerce_receipts', 'commerce_quote_requests']) {
  requireText('migration', `app.${table}`);
  requireText('schema', `'${table}'`);
}
for (const scope of ['commerce:orders:create', 'commerce:orders:read', 'commerce:receipts:read']) {
  requireText('migration', `'${scope}'`);
  requireText('commerce', `'${scope}'`);
}

const products = new Map([
  ['plan.pro.30d', 900],
  ['plan.pro.12m', 8640],
  ['plan.team.30d', 2000],
  ['plan.team.12m', 19200],
  ['highlight.24h', 100],
  ['highlight.30d', 1500],
  ['recognition.founding200', 20000],
]);
for (const [product, cents] of products) {
  requireText('migration', `'${product}'`);
  requireText('commerce', `id: '${product}'`);
  requireText('commerce', `unitAmountCents: ${cents}`);
}
requireText('migration', "'enterprise.quote'");
requireText('commerce', "id: 'enterprise.quote'");
requireText('commerce', 'unitAmountCents: null');

for (const boundary of [
  "token_prefix ~ '^sii_commerce_",
  'token_hash text not null unique',
  'max_order_amount_cents <= total_limit_cents',
  "expires_at <= created_at + interval '30 days'",
  'authorized_amount_cents + p_price_amount_cents',
  'orders_created >= delegation.max_orders',
  'for update',
  'commerce_idempotency_conflict',
  'commerce_orders_underlying_shape',
  'commerce_orders_product_shape',
  "pay_currency = 'usdc'",
  "pay_network = 'eth'",
  'commerce_receipts_immutable',
  'commerce_receipt_is_immutable',
  'capture_commerce_payment_status',
  'create_commerce_quote_request',
]) requireText('migration', boundary);

for (const proof of [
  'Exact commerce idempotency replay failed',
  'Team commerce accepted fewer seats than current membership',
  'Highlight commerce did not create its exact pending campaign',
  'Founding 200 commerce did not reserve the next exact place',
  'Rejected over-limit commerce order left partial database state',
  'Repository-bound commerce token created a personal order',
  'Revoked commerce token remained usable',
  'Confirmed Pro payment did not create one hash-backed commerce receipt',
  'Refund did not revoke access while preserving payment evidence',
  'Existing Work tokens lost their permanent zero-spend boundary',
]) requireText('smoke', proof);
requireText('testRunner', 'commerce_smoke.sql');

for (const marker of [
  'generateCommerceToken', 'commerceBearerToken', 'commerceTokenHash',
  'create_agent_commerce_order', 'ensureProviderCheckout', 'initialStatus',
  'getCommerceOrder', 'getCommerceReceipt', 'checkCommerceEligibility',
  'createCommerceQuoteRequest', 'wallet_custody', 'superii_holds_wallet_keys: false',
  "network_code: 'eth'", "token_standard: 'ERC-20'",
  "updated_at < now() - interval '2 minutes'",
]) requireText('commerce', marker);
if (files.commerce.includes('status = case when provider_payment_id is null then ${payment.payment_status}')) {
  errors.push('initial provider response must not directly install a terminal payment status');
}

for (const [file, marker] of [
  ['catalogApi', 'commerceCatalog'], ['eligibilityApi', 'checkCommerceEligibility'],
  ['ordersApi', 'createCommerceOrder'], ['orderApi', 'getCommerceOrder'],
  ['receiptApi', 'getCommerceReceipt'], ['quoteApi', 'createCommerceQuoteRequest'],
  ['delegationApi', 'create_commerce_delegation'], ['revokeApi', 'revoked_at'],
]) requireText(file, marker);
for (const file of ['eligibilityApi', 'ordersApi', 'quoteApi', 'a2aRoute']) requireText(file, 'readBoundedJsonObject');
requireText('ipn', 'readBoundedJsonObject(request, 100_000)');
requireText('ipn', 'verifyNowPaymentsIpn');
requireText('ipn', 'isUsdcEthereumRoute');
requireText('ipn', '!order.provider_payment_id');
requireText('provider', 'is_fixed_rate: true');
requireText('provider', 'is_fee_paid_by_user: true');

for (const tool of [
  'commerce_list_products', 'commerce_check_eligibility', 'commerce_create_order',
  'commerce_get_order', 'commerce_get_receipt', 'commerce_request_enterprise_quote',
]) requireText('mcp', `'${tool}'`);
requireText('mcp', "route: '/mcp/commerce'");
requireText('mcpRoute', "'mcp.commerce'");
for (const skill of [
  'commerce-list-products', 'commerce-check-eligibility', 'commerce-create-order',
  'commerce-get-order', 'commerce-get-receipt', 'commerce-request-enterprise-quote',
]) {
  requireText('card', `id: '${skill}'`);
  requireText('a2a', `z.literal('${skill}')`);
}
requireText('a2aRoute', "params.operation !== 'message:send'");
requireText('a2aRoute', 'walletCustody');

for (const marker of [
  'data-commerce-workspace', 'Allowed products', 'Maximum per order',
  'Total authorized', 'Maximum orders', 'Expires after', 'Shown once',
  'sii_agent_', 'cannot open, sign, or debit any wallet',
]) requireText('workspace', marker);
requireText('account', '<CommerceWorkspace />');
requireText('account', 'href="#commerce"');
requireText('workMcp', 'The agent cannot approve its own release, delete, pay');
if (files.workMcp.includes('commerce_create_order') || files.workMcp.includes('sii_commerce_')) {
  errors.push('Work MCP must remain separate from commerce authority');
}

for (const endpoint of [
  "'/api/commerce/catalog'", "'/api/commerce/eligibility'", "'/api/commerce/orders'",
  "'/api/commerce/orders/{orderId}'", "'/api/commerce/receipts/{receiptId}'",
  "'/api/commerce/quote-requests'", "'/api/commerce/delegations'",
  "'/a2a/commerce/v1/message:send'", 'commerceBearer',
]) requireText('openapi', endpoint);
for (const [file, marker] of [
  ['agents', 'id="commerce-lane"'], ['agentContract', 'sii_commerce_'],
  ['handoff', '## Separately delegated commerce'], ['fullGuide', '## Commerce MCP'],
  ['docs', 'id="agent-commerce"'], ['security', 'id="commerce-controls"'],
  ['privacy', 'Billing and agent-commerce information'], ['terms', 'agent-commerce credential'],
  ['docsIndex', 'commerce-catalog'], ['state', 'Bounded commerce for AI agents'],
  ['routes', '"/mcp/commerce"'],
]) requireText(file, marker);

const implementationSources = [
  files.commerce, files.mcp, files.a2a, files.workspace, files.delegationApi,
  files.ordersApi, files.orderApi, files.receiptApi, files.quoteApi,
].join('\n');
if (/sii_commerce_[a-f0-9]{40,}/.test(implementationSources)) {
  errors.push('raw commerce credential-shaped value found in implementation source');
}
if (/(private[_ -]?key|seed phrase|mnemonic).{0,30}(store|persist|collect)/i.test(implementationSources)) {
  errors.push('commerce implementation must not collect or store wallet signing material');
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('OK: universal agent commerce products, separate bounded credentials, exact USDC-on-Ethereum invoices, REST, MCP, A2A, eligibility, idempotency, fulfillment, immutable receipts, Workspace controls, and public contracts verified');
