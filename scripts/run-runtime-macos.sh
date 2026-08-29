#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$project_root/runtime/run-macos-service.sh"
