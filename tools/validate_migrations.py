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
    "repository_branches",
    "repository_uploads",
    "notifications",
    "payment_orders",
    "papers",
    "posts",
    "paper_repository_links",
    "repository_compatibility",
    "resource_groups",
    "resource_group_repositories",
    "resource_group_members",
    "service_accounts",
    "service_account_roles",
    "trusted_publishers",
    "scoped_access_tokens",
    "agent_traces",
    "cas_integrity_events",
    "runtime_model_instances",
    "runtime_benchmark_records",
    "notebook_execution_sessions",
    "external_identities",
    "bridge_oauth_states",
    "namespace_claims",
    "bridge_import_jobs",
    "bridge_import_items",
    "repository_sources",
    "bridge_sync_subscriptions",
    "bridge_events",
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

    # Repository creation belongs inside reviewed PL/pgSQL functions. Strip
    # dollar-quoted function/DO bodies before checking for forbidden seed rows.
    top_level_sql = re.sub(r"\$([a-z0-9_]*)\$.*?\$\1\$", "", lower, flags=re.DOTALL)
    if re.search(r"insert\s+into\s+app\.repositories", top_level_sql):
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
    if "create_repository_with_revision" not in lower:
        errors.append("creator publishing must create repositories and initial revisions transactionally")
    if "create_repository_commit" not in lower:
        errors.append("repository branches must support transactional commits")
    if "apply_nowpayments_status" not in lower:
        errors.append("payment activation must be transactional and idempotent")
    if "create_or_reuse_payment_order" not in lower or "pg_advisory_xact_lock" not in lower:
        errors.append("payment creation must deduplicate concurrent checkout attempts")
    if "require_release_manifest" not in lower or "release_manifest_incomplete" not in lower:
        errors.append("publication must require a structured manifest and commit checksum")
    if "sync_repository_compatibility" not in lower:
        errors.append("model inspection must persist hardware compatibility transactionally")
    if "has_repository_permission" not in lower:
        errors.append("resource-group permissions must use a fail-closed PL/pgSQL check")
    if "trusted_publishers" not in lower or "scoped_access_tokens" not in lower:
        errors.append("trusted publishing requires publisher identities and hashed short-lived tokens")
    if "'notebook'" not in lower or "static validation without code execution" not in lower:
        errors.append("notebook analysis must be an explicit no-execution database contract")
    if "create_resumable_upload" not in lower or "advance_resumable_upload" not in lower:
        errors.append("large uploads require transactional TUS session and offset functions")
    if "transition_resumable_upload" not in lower or "expire_resumable_uploads" not in lower:
        errors.append("resumable upload promotion, rejection, and expiry must be transactional")
    if "runtime_model_instances" not in lower or "runtime_benchmark_records" not in lower:
        errors.append("persistent inference and provenance-bound benchmarks require canonical records")
    if "notebook_execution_sessions" not in lower or "transition_notebook_execution" not in lower:
        errors.append("isolated notebook execution requires a bounded transactional lifecycle")
    if "is_model_derivation" not in lower:
        errors.append("Use Model lineage requires a fail-closed PL/pgSQL derivation classifier")
    if "create_bridge_import" not in lower or "claim_next_bridge_import" not in lower:
        errors.append("Bridge imports require transactional, idempotent job creation and claiming")
    if "prepare_bridge_item" not in lower or "complete_bridge_item" not in lower:
        errors.append("Bridge imports must join source snapshots to reviewed immutable revisions")
    if "claim_personal_namespace" not in lower or "namespace_identity_mismatch" not in lower:
        errors.append("Bridge namespace claims must require a matching verified external identity")
    if "claim_bridge_organization" not in lower or "organization_admin_required" not in lower:
        errors.append("Bridge organization claims must require verified provider administrator evidence")
    if "request_bridge_import_cancel" not in lower or "set_bridge_sync" not in lower:
        errors.append("Bridge jobs require cancellation and opt-in immutable synchronization")
    for relationship in ("adapter-for", "merged-from", "distilled-from"):
        if f"'{relationship}'" not in lower:
            errors.append(f"Use Model lineage type is missing: {relationship}")
    if "network_disabled boolean not null default true check (network_disabled)" not in lower:
        errors.append("notebook execution must enforce a no-network database contract")
    for scanner in ("clamav", "gitleaks", "format_policy"):
        if f"i.inspector = '{scanner}' and i.status = 'passed'" not in lower:
            errors.append(f"publish gate must require a passed {scanner} inspection")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"OK: {len(files)} migration file(s), {len(created)} tables, immutable files, "
        "search, community, lineage, Use Model derivations, agent-native access, PL/pgSQL publish gates, RLS, and empty catalog verified"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
