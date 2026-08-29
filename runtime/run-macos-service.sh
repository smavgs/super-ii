#!/bin/sh
set -eu

runtime_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

runtime_database_url=$(security find-generic-password \
  -w -s "superii-runtime-database-url" -a "superii.site")
runtime_token=$(security find-generic-password \
  -w -s "superii-runtime-token" -a "superii.site")

test -n "$runtime_database_url"
test "${#runtime_token}" -ge 32

export SUPERII_HOST="127.0.0.1"
export SUPERII_PORT="8788"
export SUPERII_STORAGE_ROOT="$runtime_root/data"
export SUPERII_DATABASE_URL="$runtime_database_url"
export SUPERII_RUNTIME_TOKEN="$runtime_token"
export SUPERII_CLAMAV_COMMAND="clamdscan"
export SUPERII_CLAMAV_CONFIG_FILE="$runtime_root/clamd-host.conf"
export SUPERII_GITLEAKS_COMMAND="gitleaks"
export SUPERII_LLAMA_CLI_COMMAND="llama-cli"
export SUPERII_LLAMA_SERVER_COMMAND="llama-server"
export SUPERII_PUBLIC_BASE_URL="https://runtime.superii.site"
export SUPERII_SPACES_IMAGE="superii/gradio-space:0.1.0"
export HF_HUB_OFFLINE="1"
export HF_DATASETS_OFFLINE="1"
export HF_HUB_DISABLE_TELEMETRY="1"
export TRANSFORMERS_OFFLINE="1"

exec "$runtime_root/.venv/bin/superii-runtime"
