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


def add_file(data: dict, path: str, content: bytes) -> None:
    checksum = hashlib.sha256(content).hexdigest()
    data["files"].append(
        {
            "path": path,
            "sha256": checksum,
            "size_bytes": len(content),
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
    )
    files = sorted(data["files"], key=lambda file: file["path"])
    manifest = hashlib.sha256()
    for file in files:
        manifest.update(f"{file['path']}\0{file['sha256']}\0{file['size_bytes']}\n".encode())
    data["manifest_sha256"] = manifest.hexdigest()
    data["file_count"] = len(files)
    data["total_size_bytes"] = sum(file["size_bytes"] for file in files)


def test_complete_evidence_passes_without_human_approval():
    decision = evaluate(candidate())
    assert decision["outcome"] == "passed"
    assert decision["evidence"]["human_review_required"] is False
    assert len(decision["policy_sha256"]) == 64


def test_registered_lfm_license_requires_and_records_license_and_notice() -> None:
    data = candidate()
    data["license"] = "lfm1.0"
    data["provenance"]["rights_declaration"] = {
        "confirmed": True,
        "basis": "licensed-redistribution",
        "source_url": "https://huggingface.co/mlx-community/LFM2.5-2.6B-4bit",
    }
    add_file(data, "LICENSE", b"LFM Open License v1.0")
    assert {reason["code"] for reason in evaluate(data)["reasons"]} == {
        "license_notice_file_required"
    }
    add_file(data, "NOTICE", b"Modification and attribution notices")

    decision = evaluate(data)

    assert decision["outcome"] == "passed"
    assert decision["evidence"]["license"] == "lfm1.0"
    assert decision["evidence"]["license_policy"] == {
        "identifier": "lfm1.0",
        "classification": "registered-conditional",
        "license_files": ["license"],
        "notice_files": ["notice"],
        "terms_reviewed_by_superii": False,
        "claim": (
            "publisher-declared terms; automated policy verifies required evidence, "
            "not legal sufficiency"
        ),
    }


def test_custom_license_can_publish_with_complete_terms() -> None:
    data = candidate()
    data["license"] = "LicenseRef-Example-Community-1.0"
    add_file(data, "LICENSE.md", b"Example complete custom terms")

    decision = evaluate(data)

    assert decision["outcome"] == "passed"
    assert decision["evidence"]["license_policy"]["classification"] == ("publisher-declared-custom")
    assert decision["evidence"]["license_policy"]["terms_reviewed_by_superii"] is False


def test_custom_license_without_complete_terms_stays_blocked() -> None:
    data = candidate()
    data["license"] = "LicenseRef-Missing-Terms"

    decision = evaluate(data)

    assert decision["outcome"] == "blocked"
    assert {reason["code"] for reason in decision["reasons"]} == {"custom_license_file_required"}


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
