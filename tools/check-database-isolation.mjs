import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [database, migration, migrationRunner, provisioner, auditor, auth, agentAuth, scopedAuth, social] = await Promise.all([
  read('src/lib/db.ts'),
  read('database/migrations/0023_runtime_least_privilege.sql'),
  read('tools/apply_migrations.py'),
  read('tools/provision_database_roles.py'),
  read('tools/audit_database_roles.py'),
  read('src/lib/auth.ts'),
  read('src/lib/agent-auth.ts'),
  read('src/lib/scoped-auth.ts'),
  read('src/lib/social.ts'),
]);

for (const role of [
  'superii_web_backend',
  'superii_payment_backend',
  'superii_publishing_backend',
  'superii_runtime_backend',
]) {
  assert.match(migration, new RegExp(`create role %I nologin[\\s\\S]+${role}|${role}[\\s\\S]+nologin`, 'i'));
}
assert.match(migration, /create schema if not exists app_private/i);
assert.match(migration, /create or replace function app\.begin_request_context/i);
assert.match(migration, /public\.hmac\(signed_payload, secret_value, 'sha256'\)/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /tenant_can_read\(text,jsonb\)/i);
assert.match(migration, /tenant_can_mutate\(text,jsonb,text\)/i);
assert.match(migration, /revoke execute on all functions in schema app/i);

assert.match(database, /DATABASE_CONTEXT_SECRET/);
assert.match(database, /DATABASE_PAYMENT_CONTEXT_SECRET/);
assert.match(database, /DATABASE_PUBLISHING_CONTEXT_SECRET/);
assert.match(database, /neonConfig\.fetchFunction/);
assert.match(database, /superiiDatabaseContext/);
assert.ok(!database.includes('fetchOptions: { headers:'), 'database context marker must preserve Neon headers');
assert.match(database, /select app\.begin_request_context/);
assert.match(database, /registeredContexts\.delete/);
assert.ok(!database.includes('fetchFunction: contextualFetch'), 'per-client global fetch mutation is unsafe');

for (const source of [auth, agentAuth, scopedAuth, social]) {
  assert.match(source, /setSqlActorContext\(/);
}
assert.match(scopedAuth, /app\.consume_scoped_access_token/);

const paymentPaths = [
  'src/pages/api/checkout.ts',
  'src/pages/api/checkout/[orderId].ts',
  'src/pages/api/participation/checkout.ts',
  'src/pages/api/participation/checkout/[orderId].ts',
  'src/pages/api/payments/nowpayments/ipn.ts',
  'src/pages/api/commerce/delegations/index.ts',
  'src/pages/api/commerce/delegations/[delegationId].ts',
  'src/pages/api/commerce/orders/index.ts',
  'src/pages/api/commerce/orders/[orderId].ts',
  'src/pages/api/commerce/quote-requests.ts',
  'src/pages/api/commerce/receipts/[receiptId].ts',
  'src/pages/api/commerce/eligibility.ts',
  'src/pages/a2a/commerce/v1/[...operation].ts',
  'src/pages/mcp/commerce.ts',
  'src/lib/commerce-a2a.ts',
  'src/lib/commerce-mcp-server.ts',
];
for (const path of paymentPaths) {
  const source = await read(path);
  assert.match(source, /payment(?:Webhook)?SqlClient\(/, `${path} must use the payment database boundary`);
  if (source.includes('ensureAuthenticatedProfile')) {
    assert.match(source, /const identitySql = sqlClient\(/, `${path} must resolve Clerk identity through the web boundary`);
    assert.match(
      source,
      /ensureAuthenticatedProfile\([^,]+, identitySql, sql\)/,
      `${path} must copy only the verified profile into the payment context`,
    );
  }
}

const publishingExchange = await read('src/pages/api/trusted-publishing/github/exchange.ts');
assert.match(publishingExchange, /publishingServiceSqlClient\(/);

assert.match(migrationRunner, /MIGRATION_DATABASE_URL/);
assert.ok(!/get\("DATABASE_URL"\)/.test(migrationRunner), 'migration runner must refuse the application URL');
assert.match(provisioner, /DEFAULT_NAMESPACE = "superii"/);
assert.match(provisioner, /return f"\{namespace\}-migration-database-url"/);
assert.match(provisioner, /--namespace/);
assert.match(provisioner, /nobypassrls/);
assert.match(provisioner, /macOS Keychain only/);
assert.match(auditor, /rls_count != table_count/);

console.log('Database isolation check: signed contexts, RLS, role compartments, and migration-only owner path OK');
