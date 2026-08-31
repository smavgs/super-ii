#!/bin/sh
set -eu

runtime_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

bridge_database_url=$(security find-generic-password \
  -w -s "superii-runtime-database-url" -a "superii.site")
bridge_runtime_token=$(security find-generic-password \
  -w -s "superii-runtime-token" -a "superii.site")
bridge_encryption_key=$(security find-generic-password \
  -w -s "superii-bridge-token-key" -a "superii.site")

test -n "$bridge_database_url"
test "${#bridge_runtime_token}" -ge 32
test "${#bridge_encryption_key}" -ge 43

export SUPERII_STORAGE_ROOT="$runtime_root/data"
export SUPERII_DATABASE_URL="$bridge_database_url"
export SUPERII_RUNTIME_TOKEN="$bridge_runtime_token"
export SUPERII_BRIDGE_TOKEN_ENCRYPTION_KEY="$bridge_encryption_key"
export SUPERII_BRIDGE_RUNTIME_URL="http://127.0.0.1:8788"
export SUPERII_BRIDGE_POLL_SECONDS="2"
export SUPERII_CLAMAV_COMMAND="clamdscan"
export SUPERII_CLAMAV_CONFIG_FILE="$runtime_root/clamd-host.conf"
export SUPERII_GITLEAKS_COMMAND="gitleaks"
export HF_HOME="$runtime_root/data/bridge-provider-cache"
export HF_HUB_DISABLE_TELEMETRY="1"
export HF_HUB_DISABLE_PROGRESS_BARS="1"
export HF_XET_HIGH_PERFORMANCE="1"
unset HF_HUB_OFFLINE HF_DATASETS_OFFLINE TRANSFORMERS_OFFLINE HF_TOKEN HUGGING_FACE_HUB_TOKEN || true

exec "$runtime_root/.venv/bin/superii-bridge"
