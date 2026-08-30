#!/usr/bin/env python3
"""Fail-closed static validation for official Super ii Jupyter notebooks."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "src" / "content" / "notebooks.json"
NOTEBOOK_LIBRARY = ROOT / "src" / "lib" / "notebooks.ts"
EXPECTED_SLUGS = {
    "super-ii-api-and-mcp",
    "create-and-verify-a-dataset",
    "reproducible-model-evaluation",
}
MAX_NOTEBOOK_BYTES = 25 * 1024 * 1024
MAX_CELLS = 2_000
MAX_CELL_SOURCE_CHARS = 250_000
CELL_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
)


def text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(part, str) for part in value):
        return "".join(value)
    return None


def main() -> int:
    errors: list[str] = []
    try:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        library_source = NOTEBOOK_LIBRARY.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as error:
        print(f"ERROR: notebook registry is unreadable: {error}", file=sys.stderr)
        return 1
    if not isinstance(registry, list):
        print("ERROR: notebook registry must be a list", file=sys.stderr)
        return 1
    slugs = {entry.get("slug") for entry in registry if isinstance(entry, dict)}
    if slugs != EXPECTED_SLUGS:
        errors.append(f"official notebook slugs must be exactly {sorted(EXPECTED_SLUGS)}")

    for entry in registry:
        if not isinstance(entry, dict):
            errors.append("notebook registry entries must be objects")
            continue
        slug = entry.get("slug")
        path_value = entry.get("path")
        if not isinstance(slug, str) or not isinstance(path_value, str):
            errors.append("notebook registry entries require string slug and path")
            continue
        relative = Path(path_value)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or not path_value.startswith("notebooks/")
            or relative.suffix.lower() != ".ipynb"
        ):
            errors.append(f"{slug}: invalid notebook path")
            continue
        path = ROOT / relative
        try:
            payload = path.read_bytes()
            raw = json.loads(payload.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            errors.append(f"{slug}: unreadable notebook: {error}")
            continue
        if len(payload) > MAX_NOTEBOOK_BYTES:
            errors.append(f"{slug}: notebook exceeds 25 MiB")
        digest = hashlib.sha256(payload).hexdigest()
        if entry.get("sha256") != digest:
            errors.append(f"{slug}: registry SHA-256 does not match source")
        if path_value not in library_source:
            errors.append(f"{slug}: notebook source is not wired into the public library")
        for field in ("title", "summary", "category", "level", "runtime", "updatedAt"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                errors.append(f"{slug}: missing {field}")
        if not isinstance(entry.get("requirements"), list) or not entry["requirements"]:
            errors.append(f"{slug}: requirements must be visible and non-empty")
        if not isinstance(entry.get("tags"), list) or not entry["tags"]:
            errors.append(f"{slug}: tags must be visible and non-empty")
        if not isinstance(entry.get("durationMinutes"), int) or not 1 <= entry["durationMinutes"] <= 240:
            errors.append(f"{slug}: durationMinutes must be 1..240")

        if not isinstance(raw, dict) or raw.get("nbformat") != 4:
            errors.append(f"{slug}: official notebooks must use nbformat 4")
            continue
        if not isinstance(raw.get("nbformat_minor"), int):
            errors.append(f"{slug}: nbformat_minor is required")
        metadata = raw.get("metadata")
        if not isinstance(metadata, dict) or not isinstance(metadata.get("kernelspec"), dict):
            errors.append(f"{slug}: kernelspec metadata is required")
        cells = raw.get("cells")
        if not isinstance(cells, list) or not cells or len(cells) > MAX_CELLS:
            errors.append(f"{slug}: cell count must be 1..{MAX_CELLS}")
            continue
        seen_ids: set[str] = set()
        for index, cell in enumerate(cells):
            if not isinstance(cell, dict) or cell.get("cell_type") not in {"markdown", "code", "raw"}:
                errors.append(f"{slug}: cell {index} has an invalid type")
                continue
            cell_id = cell.get("id")
            if not isinstance(cell_id, str) or not CELL_ID.fullmatch(cell_id):
                errors.append(f"{slug}: cell {index} has an invalid id")
            elif cell_id in seen_ids:
                errors.append(f"{slug}: duplicate cell id {cell_id}")
            else:
                seen_ids.add(cell_id)
            source = text(cell.get("source"))
            if source is None or len(source) > MAX_CELL_SOURCE_CHARS:
                errors.append(f"{slug}: cell {index} source is invalid or oversized")
            if cell.get("cell_type") == "code":
                if cell.get("execution_count") is not None or cell.get("outputs") != []:
                    errors.append(f"{slug}: official code cell {index} must be clean and unexecuted")
        decoded = payload.decode("utf-8", errors="replace")
        for pattern in SECRET_PATTERNS:
            if pattern.search(decoded):
                errors.append(f"{slug}: source resembles a credential or private key")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(
        f"OK: {len(registry)} official notebooks are valid, clean, hashed, bounded, and wired to the static reader"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
