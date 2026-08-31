#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build \
  --pull \
  --tag superii/notebook-executor:0.1.0 \
  "$runtime_dir/notebook-image"
