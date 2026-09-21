#!/bin/sh
set -eu

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is required for the PostgreSQL integration test." >&2
  exit 1
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_name="superii-postgres-test-$$"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d \
  --name "$container_name" \
  -e POSTGRES_PASSWORD=superii-local-test \
  -e POSTGRES_DB=superii_test \
  postgres:17-alpine >/dev/null

attempt=0
until ready=$(docker exec "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -Atqc "select 1" 2>/dev/null) \
  && [ "$ready" = "1" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "ERROR: PostgreSQL did not become ready." >&2
    exit 1
  fi
  sleep 1
done

for migration in "$project_root"/database/migrations/*.sql; do
  docker exec -i "$container_name" \
    psql -v ON_ERROR_STOP=1 -U postgres -d superii_test < "$migration" >/dev/null
done

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -c "
  create role superii_web_test login password 'web-test-password' inherit
    nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role superii_payment_test login password 'payment-test-password' inherit
    nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role superii_publishing_test login password 'publishing-test-password' inherit
    nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role superii_runtime_test login password 'runtime-test-password' inherit
    nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  grant superii_web_backend to superii_web_test;
  grant superii_payment_backend to superii_payment_test;
  grant superii_publishing_backend to superii_publishing_test;
  grant superii_runtime_backend to superii_runtime_test;
  insert into app_private.context_secrets(service,key_id,secret)
  values
    ('web','test-web-v1','test-web-context-secret-0123456789abcdef'),
    ('payment','test-payment-v1','test-payment-context-secret-0123456789abcdef'),
    ('publishing','test-pub-v1','test-publishing-context-secret-0123456789abcdef')
  on conflict(service,key_id) do update set secret=excluded.secret, revoked_at=null, expires_at=null;
" >/dev/null

# A second application proves the additive migrations are safe to rerun.
for migration in "$project_root"/database/migrations/*.sql; do
  docker exec -i "$container_name" \
    psql -v ON_ERROR_STOP=1 -U postgres -d superii_test < "$migration" >/dev/null
done

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/interaction_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/social_web_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/participation_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/billing_term_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/commerce_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/profile_likes_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/robot_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/assistant_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/transparent_smoke.sql" >/dev/null

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/backend_role_smoke.sql" >/dev/null

docker exec -e PGPASSWORD=web-test-password -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U superii_web_test -d superii_test \
  -v IS_WEB=1 -v IS_PAYMENT=0 -v IS_PUBLISHING=0 -v IS_RUNTIME=0 \
  -v CONTEXT_KEY=test-web-v1 \
  -v CONTEXT_SECRET=test-web-context-secret-0123456789abcdef \
  < "$project_root/database/tests/runtime_role_isolation.sql" >/dev/null

if docker exec -e PGPASSWORD=web-test-password "$container_name" \
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U superii_web_test -d superii_test -c "
    begin;
    select app.begin_request_context(
      'web', 'test-web-v1', 'clerk', 'test_user_a', null,
      null, null, null, null, false,
      extract(epoch from clock_timestamp() + interval '30 seconds')::bigint,
      gen_random_uuid(), repeat('0',64)
    );
  " >/dev/null 2>&1; then
  echo "ERROR: forged database context was accepted." >&2
  exit 1
fi

docker exec -e PGPASSWORD=payment-test-password -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U superii_payment_test -d superii_test \
  -v IS_WEB=0 -v IS_PAYMENT=1 -v IS_PUBLISHING=0 -v IS_RUNTIME=0 \
  -v CONTEXT_KEY=test-payment-v1 \
  -v CONTEXT_SECRET=test-payment-context-secret-0123456789abcdef \
  < "$project_root/database/tests/runtime_role_isolation.sql" >/dev/null

docker exec -e PGPASSWORD=publishing-test-password -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U superii_publishing_test -d superii_test \
  -v IS_WEB=0 -v IS_PAYMENT=0 -v IS_PUBLISHING=1 -v IS_RUNTIME=0 \
  -v CONTEXT_KEY=test-pub-v1 \
  -v CONTEXT_SECRET=test-publishing-context-secret-0123456789abcdef \
  < "$project_root/database/tests/runtime_role_isolation.sql" >/dev/null

docker exec -e PGPASSWORD=runtime-test-password -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U superii_runtime_test -d superii_test \
  -v IS_WEB=0 -v IS_PAYMENT=0 -v IS_PUBLISHING=0 -v IS_RUNTIME=1 \
  -v CONTEXT_KEY=test-web-v1 \
  -v CONTEXT_SECRET=test-web-context-secret-0123456789abcdef \
  < "$project_root/database/tests/runtime_role_isolation.sql" >/dev/null

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -c "
  delete from app.repositories where slug = 'private-model';
  delete from app.profiles where clerk_user_id in ('test_user_a','test_user_b');
" >/dev/null

counts=$(docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -Atc \
  "select count(*) || ':' || (select count(*) from app.repositories) from information_schema.tables where table_schema = 'app'")

if [ "$counts" != "107:0" ]; then
  echo "ERROR: unexpected post-test database state: $counts" >&2
  exit 1
fi

derivations=$(docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -Atc \
  "select app.is_model_derivation('quantized-from') || ':' || app.is_model_derivation('uses-dataset')")

if [ "$derivations" != "true:false" ]; then
  echo "ERROR: Use Model derivation classifier failed closed: $derivations" >&2
  exit 1
fi

echo "OK: PostgreSQL 17 migrations are rerunnable and the transactional integration test passed."
