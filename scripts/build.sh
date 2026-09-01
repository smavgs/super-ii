#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

secure_env_dir=""
dev_vars_backup=""

restore_dev_vars() {
  if [[ -n "$dev_vars_backup" && -f "$dev_vars_backup" ]]; then
    mv "$dev_vars_backup" "$project_dir/.dev.vars"
  fi

  if [[ -n "$secure_env_dir" ]]; then
    rmdir "$secure_env_dir" 2>/dev/null || true
  fi
}

trap restore_dev_vars EXIT INT TERM

if [[ -f .dev.vars ]]; then
  secure_env_dir="$(mktemp -d "${TMPDIR:-/tmp}/super-ii-build.XXXXXX")"
  chmod 700 "$secure_env_dir"
  dev_vars_backup="$secure_env_dir/.dev.vars"
  mv .dev.vars "$dev_vars_backup"
fi

npm run validate
node tools/copy-browser-ai-assets.mjs
npx astro build

# Astro copies public/ verbatim. Finder can recreate this harmless local file
# at any time, so remove it only from the generated release tree before the
# fail-closed metadata and secret scan.
find "$project_dir/dist" -type f -name '.DS_Store' -delete

if [[ -n "$dev_vars_backup" ]]; then
  python3 tools/validate_release_secrets.py dist "$dev_vars_backup"
else
  python3 tools/validate_release_secrets.py dist
fi
