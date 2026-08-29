#!/bin/sh
set -eu

app_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_root=$(dirname -- "$app_root")
token_file="$runtime_root/cloudflared-token"

test -x /opt/homebrew/bin/cloudflared
test -f "$token_file"
test "$(stat -f %Lp "$token_file")" = "600"

exec /opt/homebrew/bin/cloudflared tunnel \
  --no-autoupdate \
  --metrics 127.0.0.1:20242 \
  --loglevel info \
  run \
  --token-file "$token_file"
