#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
db_namespace=${1:-superii-lp-test}
preview_port=${2:-8798}

case "$db_namespace" in
  ''|*[!a-z0-9-]*)
    echo "ERROR: Keychain namespace must contain only lowercase letters, digits, and hyphens" >&2
    exit 1
    ;;
esac

case "$preview_port" in
  ''|*[!0-9]*)
    echo "ERROR: preview port must be numeric" >&2
    exit 1
    ;;
esac

umask 077
secret_file=$(mktemp -t superii-database-preview.XXXXXX)
cleanup() {
  if [ -f "$secret_file" ]; then
    rm -f -- "$secret_file"
  fi
}
trap cleanup EXIT HUP INT TERM

append_secret() {
  binding_name=$1
  service_name=$2
  secret_value=$(security find-generic-password -w -s "$service_name" -a superii.site 2>/dev/null) || {
    echo "ERROR: missing Keychain item for $binding_name" >&2
    exit 1
  }
  if [ -z "$secret_value" ]; then
    echo "ERROR: empty Keychain item for $binding_name" >&2
    exit 1
  fi
  printf '%s=%s\n' "$binding_name" "$secret_value" >> "$secret_file"
}

append_secret DATABASE_URL "$db_namespace-web-database-url"
append_secret DATABASE_CONTEXT_KEY_ID "$db_namespace-web-database-context-key-id"
append_secret DATABASE_CONTEXT_SECRET "$db_namespace-web-database-context-secret"
append_secret DATABASE_PAYMENT_URL "$db_namespace-payment-database-url"
append_secret DATABASE_PAYMENT_CONTEXT_KEY_ID "$db_namespace-payment-database-context-key-id"
append_secret DATABASE_PAYMENT_CONTEXT_SECRET "$db_namespace-payment-database-context-secret"
append_secret DATABASE_PUBLISHING_URL "$db_namespace-publishing-database-url"
append_secret DATABASE_PUBLISHING_CONTEXT_KEY_ID "$db_namespace-publishing-database-context-key-id"
append_secret DATABASE_PUBLISHING_CONTEXT_SECRET "$db_namespace-publishing-database-context-secret"

cd "$project_root"
npx wrangler dev \
  --port "$preview_port" \
  --show-interactive-dev-session=false \
  --log-level=error \
  --env-file "$project_root/.dev.vars" \
  --env-file "$secret_file"
