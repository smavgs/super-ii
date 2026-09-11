#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if command -v go >/dev/null 2>&1; then
  exec go run ./tools/releasecheck "$@"
fi

go_image="${SUPERII_GO_IMAGE:-golang:1.26-alpine}"
if command -v docker >/dev/null 2>&1 \
  && docker info >/dev/null 2>&1 \
  && docker image inspect "$go_image" >/dev/null 2>&1; then
  exec docker run --rm --network none \
    --volume "$project_dir:/workspace:ro" \
    --workdir /workspace \
    "$go_image" go run ./tools/releasecheck "$@"
fi

echo "ERROR: release verification requires Go or the preloaded $go_image Docker image" >&2
exit 1
