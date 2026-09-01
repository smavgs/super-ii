#!/usr/bin/env python3
"""Fail closed when private local values appear in a production build."""

from __future__ import annotations

import json
import sys
from pathlib import Path


PRIVATE_KEYS = {
    "CLERK_SECRET_KEY",
    "DATABASE_URL",
    "CONTACT_HASH_SALT",
    "GEMINI_API_KEY",
}


def parse_private_values(env_file: Path) -> dict[str, str]:
    values: dict[str, str] = {}

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, raw_value = line.split("=", 1)
        key = key.strip()
        if key not in PRIVATE_KEYS:
            continue

        raw_value = raw_value.strip()
        try:
            value = json.loads(raw_value) if raw_value.startswith(('"', "'")) else raw_value
        except json.JSONDecodeError:
            value = raw_value.strip('"\'')

        if isinstance(value, str) and len(value) >= 20:
            values[key] = value

    return values


def main() -> int:
    if len(sys.argv) not in {2, 3}:
        print("Usage: validate_release_secrets.py <build-directory> [private-env-file]", file=sys.stderr)
        return 2

    build_dir = Path(sys.argv[1]).resolve()
    env_file = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else None

    if not build_dir.is_dir():
        print(f"ERROR: build directory does not exist: {build_dir}", file=sys.stderr)
        return 1

    files = [path for path in build_dir.rglob("*") if path.is_file()]
    forbidden_files = [
        path
        for path in files
        if path.name == ".dev.vars" or path.name == ".DS_Store" or path.name.startswith("._")
    ]
    if forbidden_files:
        names = ", ".join(
            str(path.relative_to(build_dir)) for path in sorted(forbidden_files)
        )
        print(f"ERROR: forbidden local metadata entered the production build: {names}", file=sys.stderr)
        return 1

    private_values = parse_private_values(env_file) if env_file and env_file.is_file() else {}
    leaks: list[tuple[str, Path]] = []

    for path in files:
        data = path.read_bytes()
        for key, value in private_values.items():
            if value.encode("utf-8") in data:
                leaks.append((key, path.relative_to(build_dir)))

    if leaks:
        for key, relative_path in leaks:
            print(f"ERROR: {key} was bundled in {relative_path}", file=sys.stderr)
        return 1

    print(f"OK: scanned {len(files)} release files; no private local values were bundled")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
