#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

python3 tools/validate_runtime_registry.py

probe() {
  local label="$1"
  shift
  local executable="$1"
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'SKIP: %s is not installed on this verification host; registry status remains docs-reviewed only.\n' "$label"
    return 0
  fi

  local output
  if output=$("$@" 2>&1); then
    output="${output//$'\n'/ | }"
    output="${output:0:300}"
    printf 'FOUND: %s | %s\n' "$label" "$output"
  else
    printf 'NOTE: %s is installed but did not return version evidence with the safe probe.\n' "$label"
  fi
}

probe_python_package() {
  local label="$1"
  local launcher_name="$2"
  local distribution="$3"
  if ! command -v "$launcher_name" >/dev/null 2>&1; then
    printf 'SKIP: %s is not installed on this verification host; registry status remains docs-reviewed only.\n' "$label"
    return 0
  fi

  local launcher_path resolved_path environment_python version
  launcher_path="$(command -v "$launcher_name")"
  resolved_path="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$launcher_path")"
  environment_python="$(dirname "$resolved_path")/python"
  if [[ -x "$environment_python" ]] && version=$("$environment_python" -c 'from importlib.metadata import version; import sys; print(version(sys.argv[1]))' "$distribution" 2>/dev/null); then
    printf 'FOUND: %s | %s %s\n' "$label" "$distribution" "$version"
  else
    printf 'NOTE: %s is installed but its package version could not be read without changing the environment.\n' "$label"
  fi
}

probe "llama.cpp" llama-cli --version
probe "Ollama" ollama --version
probe_python_package "MLX LM" mlx_lm.generate mlx-lm
probe "LM Studio CLI" lms --version
probe "Docker" docker --version
probe "uv" uv --version
probe "Node.js" node --version
probe "Python" python3 --version

printf 'OK: installed runtime probes completed without upgrading, installing, downloading, or starting a service.\n'
