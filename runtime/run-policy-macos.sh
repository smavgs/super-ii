#!/bin/sh
set -eu

runtime_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export SUPERII_DATABASE_URL="$(security find-generic-password \
  -w -s "superii-policy-database-url" -a "superii.site")"
export SUPERII_POLICY_TOKEN="$(security find-generic-password \
  -w -s "superii-policy-token" -a "superii.site")"
export SUPERII_POLICY_SIGNING_KEY="$(security find-generic-password \
  -w -s "superii-policy-signing-key" -a "superii.site")"
export SUPERII_POLICY_KEY_ID="$(security find-generic-password \
  -w -s "superii-policy-key-id" -a "superii.site")"
unset SUPERII_RUNTIME_TOKEN SUPERII_TRANSFER_TOKEN SUPERII_BRIDGE_TOKEN_ENCRYPTION_KEY
exec "$runtime_root/.venv/bin/superii-policy"
