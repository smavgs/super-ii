#!/bin/sh
set -eu

runtime_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

transfer_token=$(security find-generic-password \
  -w -s "superii-runtime-token" -a "superii.site")
test "${#transfer_token}" -ge 32

export SUPERII_TRANSFER_ROOT="$runtime_root/data"
export SUPERII_TRANSFER_TOKEN="$transfer_token"
export SUPERII_TRANSFER_HOST="127.0.0.1"
export SUPERII_TRANSFER_PORT="8790"
export SUPERII_MAX_UPLOAD_BYTES="10737418240"
export SUPERII_TRANSFER_MAX_CHUNK_BYTES="33554432"
export RUST_LOG="superii_data_plane=info"

exec "$runtime_root/bin/superii-transferd"
