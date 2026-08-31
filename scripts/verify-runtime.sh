#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cargo fmt --manifest-path "$project_dir/rust/Cargo.toml" --check
cargo build --locked --bins --manifest-path "$project_dir/rust/Cargo.toml"
cargo test --locked --manifest-path "$project_dir/rust/Cargo.toml"
cargo clippy --locked --all-targets --manifest-path "$project_dir/rust/Cargo.toml" -- -D warnings

uv sync --directory "$project_dir/runtime" --extra test --frozen
uv run --directory "$project_dir/runtime" ruff format --check .
uv run --directory "$project_dir/runtime" ruff check .
uv run --directory "$project_dir/runtime" pytest
uv lock --directory "$project_dir/runtime/space-image" --check
uv lock --directory "$project_dir/runtime/notebook-image" --check

docker build --tag superii/notebook-executor:0.1.0 "$project_dir/runtime/notebook-image"
docker build --tag superii/transfer:0.1.0 "$project_dir/rust"
SUPERII_DATABASE_URL="postgresql://example.invalid/db" \
SUPERII_RUNTIME_TOKEN="01234567890123456789012345678901" \
  docker compose --file "$project_dir/runtime/compose.yaml" config --quiet
