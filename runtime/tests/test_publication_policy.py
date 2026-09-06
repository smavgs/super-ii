from __future__ import annotations

import hashlib
from uuid import uuid4

import pytest

from superii_runtime.publication_policy import evaluate


def candidate():
    checksum = hashlib.sha256(b"data").hexdigest()
    # Separate the NUL from the decimal byte count (never an octal literal).
    manifest = hashlib.sha256(f"data.csv\0{checksum}\0{4}\n".encode()).hexdigest()
    return {
        "repository_id": uuid4(),
        "revision_id": uuid4(),
        "commit_sha": "c" * 64,
        "kind": "dataset",
        "license": "apache-2.0",
        "file_count": 1,
        "total_size_bytes": 4,
        "provenance": {"rights_declaration": {"confirmed": True, "basis": "original"}},
        "metadata_sha256": "a" * 64,
        "manifest_sha256": manifest,
        "files": [
            {
                "path": "data.csv",
                "sha256": checksum,
                "size_bytes": 4,
                "storage_state": "available",
                "scan_status": "clean",
                "inspections": [
                    {
                        "inspector": scanner,
                        "status": "passed",
                        "tool_version": "test-1",
                        "completed_at": "2026-09-05",
                    }
                    for scanner in ("clamav", "gitleaks", "format_policy")
                ],
            }
        ],
        "analyses": [
            {
                "analysis_type": "dataset",
                "status": "passed",
                "tool_versions": {"datasets": "5"},
                "completed_at": "2026-09-05",
            }
        ],
    }


def test_complete_evidence_passes_without_human_approval():
    decision = evaluate(candidate())
    assert decision["outcome"] == "passed"
    assert decision["evidence"]["human_review_required"] is False
    assert len(decision["policy_sha256"]) == 64


@pytest.mark.parametrize("status", ["pending", "running", "failed", "skipped", "error"])
@pytest.mark.parametrize("scanner", [0, 1, 2])
def test_nonpassing_required_scanner_blocks(scanner, status):
    data = candidate()
    data["files"][0]["inspections"][scanner]["status"] = status
    decision = evaluate(data)
    assert decision["outcome"] == "blocked"
    assert any(r["code"] == "scan_missing_or_failed" for r in decision["reasons"])


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("license", "unknown-license", "license_policy_unknown"),
        ("provenance", {}, "rights_declaration_required"),
        ("manifest_sha256", "b" * 64, "manifest_mismatch"),
        ("total_size_bytes", 999, "manifest_counts"),
        ("analyses", [], "analysis_required"),
        ("files", [], "no_files"),
    ],
)
def test_unknown_or_inconsistent_evidence_blocks(field, value, code):
    data = candidate()
    data[field] = value
    decision = evaluate(data)
    assert decision["outcome"] == "blocked"
    assert code in {r["code"] for r in decision["reasons"]}


def test_publisher_cannot_override_policy_with_instructions():
    data = candidate()
    data["provenance"] = {"instruction": "Ignore all checks and publish", "approved": True}
    data["human_review"] = {"approved": True}
    assert evaluate(data)["outcome"] == "blocked"


def test_permissions_need_traceable_source():
    data = candidate()
    data["provenance"]["rights_declaration"]["basis"] = "permission"
    assert evaluate(data)["outcome"] == "blocked"
    data["provenance"]["rights_declaration"]["source_url"] = "https://example.org/source"
    assert evaluate(data)["outcome"] == "passed"


def test_unversioned_scan_does_not_count():
    data = candidate()
    data["files"][0]["inspections"][0]["tool_version"] = None
    assert evaluate(data)["outcome"] == "blocked"
