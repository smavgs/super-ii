"""Deterministic publication policy. No model, prompt, or agent can alter these gates."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

VERSION = "superii-auto-publish-v2"
POLICY_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
RECOGNIZED_LICENSES = frozenset(
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
UNUSABLE_LICENSE_LABELS = frozenset(
    {
        "",
        "none",
        "no-license",
        "no license",
        "tbd",
        "unknown",
        "unknown-license",
        "unlicensed",
    }
)
LICENSE_FILE_NAMES = frozenset({"license", "license.md", "license.txt"})
NOTICE_FILE_NAMES = frozenset({"notice", "notice.md", "notice.txt"})
REGISTERED_LICENSE_RULES = {
    "lfm1.0": {
        "classification": "registered-conditional",
        "required_files": (LICENSE_FILE_NAMES, NOTICE_FILE_NAMES),
    }
}
REQUIRED = frozenset({"clamav", "gitleaks", "format_policy"})
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def _root_file_name(path: str) -> str | None:
    normalized = path.replace("\\", "/").strip("/").lower()
    return normalized if normalized and "/" not in normalized else None


def _valid_tokenizer_analysis(analysis: dict[str, Any], revision_id: Any) -> bool:
    if (
        analysis.get("analysis_type") != "tokenizer"
        or analysis.get("status") != "passed"
        or not analysis.get("tool_versions")
        or not analysis.get("completed_at")
    ):
        return False
    result = analysis.get("result")
    if not isinstance(result, dict) or result.get("verified") is not True:
        return False
    applicable = result.get("applicable")
    if applicable is False:
        return True
    if applicable is not True:
        return False
    manifest = result.get("manifest")
    verification = manifest.get("verification") if isinstance(manifest, dict) else None
    return bool(
        isinstance(manifest, dict)
        and manifest.get("version") == "superii-tokenizer-pack-v1"
        and manifest.get("source_revision_id") == str(revision_id)
        and isinstance(manifest.get("pack_sha256"), str)
        and SHA256.fullmatch(str(manifest["pack_sha256"]))
        and manifest.get("engine") in {"huggingface-tokenizers", "llama.cpp"}
        and manifest.get("integrity") == "sha256-content-addressed"
        and isinstance(verification, dict)
        and verification.get("encode") == "passed"
        and verification.get("decode") == "passed"
        and verification.get("unicode") == "passed"
    )


def _license_evidence(
    license_id: str,
    files: list[dict[str, Any]],
    block: Any,
) -> dict[str, Any]:
    """Classify declarations without pretending to interpret their legal terms."""

    root_files = {
        name for file in files if (name := _root_file_name(str(file.get("path") or ""))) is not None
    }
    matching_license_files = sorted(root_files & LICENSE_FILE_NAMES)
    matching_notice_files = sorted(root_files & NOTICE_FILE_NAMES)

    if license_id in UNUSABLE_LICENSE_LABELS:
        block(
            "license_policy_unknown",
            "Name the license or custom terms that authorize publication.",
        )
        classification = "missing-or-placeholder"
        required_groups: tuple[frozenset[str], ...] = ()
    elif license_id in RECOGNIZED_LICENSES:
        classification = "recognized-identifier"
        required_groups = ()
    elif license_id in REGISTERED_LICENSE_RULES:
        rule = REGISTERED_LICENSE_RULES[license_id]
        classification = str(rule["classification"])
        required_groups = rule["required_files"]
    else:
        classification = "publisher-declared-custom"
        required_groups = (LICENSE_FILE_NAMES,)

    for required_group in required_groups:
        if root_files.isdisjoint(required_group):
            if required_group is LICENSE_FILE_NAMES:
                block(
                    "custom_license_file_required",
                    "Add the complete custom license as LICENSE, LICENSE.md, "
                    "or LICENSE.txt at the repository root.",
                )
            else:
                block(
                    "license_notice_file_required",
                    "This registered license also requires NOTICE, NOTICE.md, "
                    "or NOTICE.txt at the repository root.",
                )

    return {
        "identifier": license_id,
        "classification": classification,
        "license_files": matching_license_files,
        "notice_files": matching_notice_files,
        "terms_reviewed_by_superii": False,
        "claim": (
            "publisher-declared terms; automated policy verifies required evidence, "
            "not legal sufficiency"
        ),
    }


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
    if candidate["kind"] == "model" and not any(
        _valid_tokenizer_analysis(a, candidate["revision_id"]) for a in analyses
    ):
        block(
            "verified_tokenizer_required",
            "Verify and package the model tokenizer before publication.",
        )
    license_id = str(candidate.get("license") or "").lower().strip()
    license_evidence = _license_evidence(license_id, files, block)
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
            "license_policy": license_evidence,
            "provenance": provenance,
            "provenance_claim": "publisher-declared or verified import lineage; not a legal ruling",
            "human_review_required": False,
        },
    }
