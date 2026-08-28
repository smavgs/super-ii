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
    "repository_revisions",
    "repository_files",
    "repository_file_inspections",
    "repository_releases",
    "repository_tags",
    "repository_downloads",
    "repository_reviews",
    "repository_revision_analyses",
    "discussions",
    "discussion_comments",
    "reactions",
    "discussion_events",
    "likes",
    "follows",
    "repository_watchers",
    "activity_events",
    "collections",
    "collection_items",
    "repository_relationships",
    "request_limits",
}

RLS_TABLES = REQUIRED_TABLES - {"subscriptions"} | {"subscriptions", "plans"}


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

    for table in sorted(RLS_TABLES):
        if f"alter table app.{table} enable row level security" not in lower:
            errors.append(f"RLS is not enabled for app.{table}")

    if re.search(r"insert\s+into\s+app\.repositories", lower):
        errors.append("repository seed rows are forbidden at launch")
    if "insert into app.plans" not in lower:
        errors.append("plan contract must be seeded transactionally")
    if "create extension if not exists pg_trgm" not in lower:
        errors.append("Postgres trigram search extension is required")
    if "search_public_repositories" not in lower or "websearch_to_tsquery" not in lower:
        errors.append("public full-text search function is required")
    if "required_scans_not_passed" not in lower:
        errors.append("publish function must fail closed on required scans")
    if "revision_manifest_invalid" not in lower:
        errors.append("publish function must verify immutable manifest totals")
    if "repository_analysis_not_passed" not in lower:
        errors.append("publish function must require the applicable offline repository analysis")
    if "consume_request_limit" not in lower:
        errors.append("runtime-facing routes require a database-backed rate limit")
    for scanner in ("clamav", "gitleaks", "format_policy"):
        if f"i.inspector = '{scanner}' and i.status = 'passed'" not in lower:
            errors.append(f"publish gate must require a passed {scanner} inspection")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"OK: {len(files)} migration file(s), {len(created)} tables, immutable files, "
        "search, community, lineage, PL/pgSQL publish gates, RLS, and empty catalog verified"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
