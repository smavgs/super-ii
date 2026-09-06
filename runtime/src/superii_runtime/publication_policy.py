"""Deterministic publication policy. No model, prompt, or agent can alter these gates."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

VERSION = "superii-auto-publish-v1"
POLICY_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
LICENSES = frozenset(
    {
        "mit",
        "apache-2.0",
        "bsd-2-clause",
        "bsd-3-clause",
        "isc",
        "0bsd",
        "unlicense",
        "cc0-1.0",
        "cc-by-4.0",
        "cc-by-sa-4.0",
        "cc-by-nc-4.0",
        "cc-by-nc-sa-4.0",
        "mpl-2.0",
        "gpl-2.0",
        "gpl-3.0",
        "gpl-2.0-only",
        "gpl-3.0-only",
        "gpl-2.0-or-later",
        "gpl-3.0-or-later",
        "agpl-3.0",
        "agpl-3.0-only",
        "lgpl-3.0-only",
        "lgpl-2.1-only",
        "odc-by",
        "odbl-1.0",
        "openrail",
        "bigscience-openrail-m",
    }
)
REQUIRED = frozenset({"clamav", "gitleaks", "format_policy"})


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def evaluate(candidate: dict[str, Any]) -> dict[str, Any]:
    reasons: list[dict[str, str]] = []

    def block(code: str, message: str) -> None:
        reasons.append({"code": code, "message": message})

    files = candidate.get("files") or []
    if not files:
        block("no_files", "Upload at least one file.")
    digest = hashlib.sha256()
    scan_evidence = []
    for file in sorted(files, key=lambda f: f["path"]):
        digest.update(f"{file['path']}\0{file['sha256']}\0{file['size_bytes']}\n".encode())
        if file["storage_state"] != "available" or file["scan_status"] != "clean":
            block("file_not_clean", f"Replace or rescan {file['path']}.")
        scans = {scan["inspector"]: scan for scan in file.get("inspections", [])}
        for scanner in sorted(REQUIRED):
            scan = scans.get(scanner)
            if (
                not scan
                or scan["status"] != "passed"
                or not scan.get("tool_version")
                or not scan.get("completed_at")
            ):
                block(
                    "scan_missing_or_failed",
                    f"{file['path']}: {scanner} must pass with versioned evidence.",
                )
            else:
                scan_evidence.append({"file_sha256": file["sha256"], **scan})
    if digest.hexdigest() != candidate.get("manifest_sha256"):
        block("manifest_mismatch", "Finalize the current immutable file manifest again.")
    if len(files) != candidate.get("file_count") or sum(
        int(f["size_bytes"]) for f in files
    ) != candidate.get("total_size_bytes"):
        block("manifest_counts", "Manifest file counts or sizes have changed.")
    analyses = candidate.get("analyses") or []
    if not any(
        a["analysis_type"] == candidate["kind"]
        and a["status"] == "passed"
        and a.get("tool_versions")
        and a.get("completed_at")
        for a in analyses
    ):
        block("analysis_required", "The applicable offline repository inspection must pass.")
    if any(a["status"] != "passed" for a in analyses):
        block("analysis_failed", "Resolve every failed or unavailable revision inspection.")
    license_id = str(candidate.get("license") or "").lower().strip()
    if license_id not in LICENSES:
        block(
            "license_policy_unknown",
            "Supply a supported license identifier. Custom licenses stay "
            "blocked until a versioned policy explicitly supports them.",
        )
    provenance = candidate.get("provenance") or {}
    bridge = provenance.get("bridge") or {}
    declaration = provenance.get("rights_declaration") or {}
    declared = declaration.get("confirmed") is True and declaration.get("basis") in {
        "original",
        "permission",
        "licensed-redistribution",
    }
    imported = (
        bridge.get("provider") == "huggingface"
        and urlsplit(str(bridge.get("source_url", ""))).hostname == "huggingface.co"
        and bool(bridge.get("source_revision"))
        and bridge.get("source_unchanged") is True
    )
    if not declared and not imported:
        block(
            "rights_declaration_required",
            "Declare original authorship, permission, or licensed "
            "redistribution with a source, or use a verified Bridge import.",
        )
    if declared and declaration["basis"] != "original":
        source = urlsplit(str(declaration.get("source_url", "")))
        if source.scheme != "https" or not source.hostname or source.username or source.password:
            block("provenance_source_required", "Redistributed work needs its HTTPS source URL.")
    if candidate["kind"] == "model" and any(
        f["path"].lower().endswith((".py", ".pkl", ".pickle", ".pt", ".pth", ".bin")) for f in files
    ):
        block(
            "executable_model_format",
            "Publish standard safetensors/GGUF weights without custom "
            "Python or pickle-based weights. Unsupported formats remain quarantined.",
        )
    return {
        "repository_id": str(candidate["repository_id"]),
        "revision_id": str(candidate["revision_id"]),
        "commit_sha": candidate["commit_sha"],
        "manifest_sha256": candidate["manifest_sha256"],
        "metadata_sha256": candidate["metadata_sha256"],
        "policy_version": VERSION,
        "policy_sha256": POLICY_SHA256,
        "outcome": "blocked" if reasons else "passed",
        "reasons": reasons,
        "evidence": {
            "scans": scan_evidence,
            "analyses": analyses,
            "license": license_id,
            "provenance": provenance,
            "provenance_claim": "publisher-declared or verified import lineage; not a legal ruling",
            "human_review_required": False,
        },
    }
