#!/usr/bin/env python3
"""Static guardrails for the checked-in Postgres/PLpgSQL migration set."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"
REQUIRED_TABLES = {
    "profiles",
    "organizations",
    "organization_members",
    "plans",
    "subscriptions",
    "repositories",
    "waitlist",
    "contact_submissions",
    "audit_events",
}


def main() -> int:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        print("ERROR: no SQL migrations found", file=sys.stderr)
        return 1

    combined = "\n".join(path.read_text(encoding="utf-8") for path in files)
    lower = combined.lower()
    errors: list[str] = []

    if not re.search(r"\bbegin\s*;", lower) or not re.search(r"\bcommit\s*;", lower):
        errors.append("migrations must use an explicit transaction")
    if "language plpgsql" not in lower:
        errors.append("at least one real PL/pgSQL function is required")
    if "security invoker" not in lower:
        errors.append("contact function must state its security mode")
    if "set search_path" not in lower:
        errors.append("PL/pgSQL functions must pin search_path")

    created = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+app\.([a-z_]+)", lower))
    missing = REQUIRED_TABLES - created
    if missing:
        errors.append(f"required tables missing: {sorted(missing)}")

    for table in ("profiles", "organizations", "repositories", "waitlist", "contact_submissions", "audit_events"):
        if f"alter table app.{table} enable row level security" not in lower:
            errors.append(f"RLS is not enabled for app.{table}")

    if re.search(r"insert\s+into\s+app\.repositories", lower):
        errors.append("repository seed rows are forbidden at launch")
    if "insert into app.plans" not in lower:
        errors.append("plan contract must be seeded transactionally")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"OK: {len(files)} migration file(s), {len(created)} tables, PL/pgSQL, RLS, and empty repository catalog verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
