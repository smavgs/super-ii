from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, BinaryIO
from uuid import UUID

from .database import RepositoryDatabase
from .inspectors import inspect_safetensors
from .scanners import ScanResult, enforce_format_policy, scan_clamav, scan_gitleaks
from .settings import Settings
from .storage import ObjectStore


class UploadRejected(RuntimeError):
    def __init__(self, results: list[ScanResult]) -> None:
        self.results = results
        super().__init__("upload failed a security or format gate")


class UploadHeld(RuntimeError):
    def __init__(self, results: list[ScanResult]) -> None:
        self.results = results
        super().__init__("upload remains quarantined because a required scanner errored")


def _safetensors_scan(path: Path) -> ScanResult:
    if path.suffix.lower() != ".safetensors":
        return ScanResult(
            scanner="safetensors",
            status="skipped",
            tool_version="0.8.0",
            result={"reason": "not_safetensors"},
        )
    try:
        result = inspect_safetensors(path)
        return ScanResult("safetensors", "passed", "0.8.0", result)
    except (OSError, ValueError, TypeError) as error:
        return ScanResult(
            "safetensors",
            "failed",
            "0.8.0",
            {"reason": "invalid_safetensors", "error": str(error)[:500]},
        )


def process_upload(
    *,
    source: BinaryIO,
    repository_path: str,
    mime_type: str | None,
    repository_id: UUID,
    revision_id: UUID,
    created_by: str,
    settings: Settings,
    database: RepositoryDatabase,
    store: ObjectStore,
) -> dict[str, Any]:
    staged = store.stage(source, repository_path, mime_type)
    try:
        file_id = database.register_staged_file(
            repository_id,
            revision_id,
            staged,
            created_by,
        )
    except Exception:
        store.reject(staged)
        raise

    database.set_revision_status(revision_id, "scanning")
    results = [
        enforce_format_policy(staged.path),
        scan_clamav(staged.absolute_path, settings),
        scan_gitleaks(staged.absolute_path, settings),
        _safetensors_scan(staged.absolute_path),
    ]
    for result in results:
        database.record_inspection(
            file_id,
            result.scanner,
            result.status,
            result.tool_version,
            result.result,
        )

    if any(result.status == "failed" for result in results):
        database.mark_file_rejected(file_id, "failed")
        database.set_revision_status(revision_id, "rejected")
        store.reject(staged)
        raise UploadRejected(results)
    if any(result.status == "error" for result in results):
        database.mark_file_scan_error(file_id)
        database.set_revision_status(revision_id, "quarantined")
        raise UploadHeld(results)

    stored = store.promote(staged)
    database.mark_file_available(file_id, stored)
    database.set_revision_status(revision_id, "quarantined")
    return {
        "file_id": str(file_id),
        "repository_id": str(repository_id),
        "revision_id": str(revision_id),
        "path": staged.path,
        "size_bytes": staged.size_bytes,
        "mime_type": staged.mime_type,
        "sha256": staged.sha256,
        "storage_state": "available",
        "scan_status": "clean",
        "inspections": [asdict(result) for result in results],
    }
