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
until docker exec "$container_name" pg_isready -U postgres -d superii_test >/dev/null 2>&1; do
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

# A second application proves the additive migrations are safe to rerun.
for migration in "$project_root"/database/migrations/*.sql; do
  docker exec -i "$container_name" \
    psql -v ON_ERROR_STOP=1 -U postgres -d superii_test < "$migration" >/dev/null
done

docker exec -i "$container_name" \
  psql -v ON_ERROR_STOP=1 -U postgres -d superii_test \
  < "$project_root/database/tests/interaction_smoke.sql" >/dev/null

counts=$(docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d superii_test -Atc \
  "select count(*) || ':' || (select count(*) from app.repositories) from information_schema.tables where table_schema = 'app'")

if [ "$counts" != "36:0" ]; then
  echo "ERROR: unexpected post-test database state: $counts" >&2
  exit 1
fi

echo "OK: PostgreSQL 17 migrations are rerunnable and the transactional integration test passed."
