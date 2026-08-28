#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f package-lock.json ]]; then
  echo "ERROR: package-lock.json is required for reproducible deployment" >&2
  exit 1
fi

echo "[1/4] Checking types and Astro templates"
npm run check

echo "[2/4] Validating content, routes, migrations, and brand asset"
npm run validate
npm run db:check

echo "[3/4] Building the Cloudflare Worker"
npm run build

echo "[4/4] Deploying the verified build"
npx wrangler deploy
