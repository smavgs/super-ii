// Only bundled by the isolated connection integration test. Never shipped.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, randomUUID } from 'node:crypto';
const execute = promisify(execFile);
const states = new WeakMap();
const clients = new WeakMap();
function literal(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `array[${value.map(literal).join(',')}]::text[]`;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}
export async function queryDatabase(query, actor = null, owner = false) {
  const container = process.env.SUPERII_TEST_PG_CONTAINER;
  if (!/^superii-postgres-test-[0-9]+$/.test(container ?? ''))
    throw new Error('An ephemeral database test container is required');
  let context = '';
  if (!owner) {
    const kind = actor?.actorKind ?? (actor?.clerkUserId ? 'clerk' : 'public');
    const expires = Math.floor(Date.now() / 1000) + 30;
    const nonce = randomUUID();
    const pieces = [
      'superii-db-context-v1',
      'web',
      'test-web-v1',
      kind,
      actor?.clerkUserId ?? '',
      actor?.clerkOrganizationId ?? '',
      actor?.profileId ?? '',
      actor?.organizationId ?? '',
      actor?.agentIdentityId ?? '',
      actor?.socialAgentId ?? '',
      '0',
      String(expires),
      nonce,
    ];
    const signature = createHmac('sha256', 'test-web-context-secret-0123456789abcdef')
      .update(pieces.join('\n'))
      .digest('hex');
    const args = [
      'web',
      'test-web-v1',
      kind,
      actor?.clerkUserId ?? null,
      actor?.clerkOrganizationId ?? null,
      actor?.profileId ?? null,
      actor?.organizationId ?? null,
      actor?.agentIdentityId ?? null,
      actor?.socialAgentId ?? null,
      false,
      expires,
      nonce,
      signature,
    ];
    context = `select app.begin_request_context(${args.map(literal).join(',')});`;
  }
  const wrapped = /^\s*(update|insert|delete)\b/i.test(query)
    ? `with connection_test_rows as (${query}) select coalesce(jsonb_agg(connection_test_rows),'[]'::jsonb) from connection_test_rows`
    : `select coalesce(jsonb_agg(connection_test_rows),'[]'::jsonb) from (${query}) connection_test_rows`;
  const command = [
    'exec',
    '-e',
    'PGPASSWORD=web-test-password',
    container,
    'psql',
    '-X',
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    ...(owner ? ['-U', 'postgres'] : ['-h', '127.0.0.1', '-U', 'superii_web_test']),
    '-d',
    'superii_test',
    '-c',
    `begin; ${context} ${wrapped}; commit;`,
  ];
  const result = await execute('docker', command, { maxBuffer: 2_000_000 }).catch((error) => {
    if (process.env.SUPERII_TEST_DB_DEBUG === '1')
      process.stderr.write(
        (error.stderr?.match(/ERROR:[^\n]*/)?.[0] ?? 'Database fixture error') + '\n',
      );
    throw error;
  });
  return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1));
}
export function sqlClient(locals) {
  if (!clients.has(locals)) {
    const client = async (strings, ...values) =>
      queryDatabase(
        strings.reduce(
          (out, part, i) => out + part + (i < values.length ? literal(values[i]) : ''),
          '',
        ),
        states.get(client),
      );
    states.set(client, locals.__testActor ?? {});
    clients.set(locals, client);
  }
  return clients.get(locals);
}
export function setSqlActorContext(sql, patch) {
  states.set(sql, { ...states.get(sql), ...patch });
}
export function runtimeValue(_locals, key) {
  return key === 'CONTACT_HASH_SALT' ? 'isolated-connection-test-salt' : undefined;
}
export const paymentSqlClient = sqlClient;
export const publishingServiceSqlClient = sqlClient;
