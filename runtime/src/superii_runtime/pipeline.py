from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, BinaryIO
from uuid import UUID

from .database import RepositoryDatabase
from .inspectors import inspect_safetensors
from .scanners import ScanResult, enforce_format_policy, scan_clamav, scan_gitleaks
from .settings import Settings
from .storage import ObjectStore, StagedObject, StoredObject, normalize_repository_path
from .transfers import request_transfer_sync


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


def _scan_staged(staged: StagedObject, settings: Settings) -> list[ScanResult]:
    return [
        enforce_format_policy(staged.path),
        scan_clamav(staged.absolute_path, settings),
        scan_gitleaks(staged.absolute_path, settings),
        _safetensors_scan(staged.absolute_path),
    ]


def _record_results(
    database: RepositoryDatabase,
    file_id: UUID,
    results: list[ScanResult],
) -> None:
    for result in results:
        database.record_inspection(
            file_id,
            result.scanner,
            result.status,
            result.tool_version,
            result.result,
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
    results = _scan_staged(staged, settings)
    _record_results(database, file_id, results)

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


def process_completed_transfer(
    *,
    record: dict[str, Any],
    settings: Settings,
    database: RepositoryDatabase,
) -> dict[str, Any]:
    """Scan one completed Rust transfer and atomically publish it into immutable CAS."""

    upload_id = UUID(str(record.get("id")))
    repository_id = UUID(str(record.get("repository_id")))
    revision_id = UUID(str(record.get("revision_id")))
    repository_path = normalize_repository_path(str(record.get("path", "")))
    actual_sha256 = str(record.get("actual_sha256") or "")
    expected_sha256 = str(record.get("expected_sha256") or "")
    length = int(record.get("length", -1))
    status = str(record.get("status", ""))
    if length < 1 or actual_sha256 != expected_sha256 or len(actual_sha256) != 64:
        raise RuntimeError("transfer checksum contract is incomplete")

    upload = database.get_resumable_upload(upload_id)
    if upload is None:
        raise RuntimeError("transfer database record was not found")
    if (
        upload["repository_id"] != repository_id
        or upload["revision_id"] != revision_id
        or upload["path"] != repository_path
        or int(upload["expected_size_bytes"]) != length
        or upload["expected_sha256"] != actual_sha256
    ):
        raise RuntimeError("transfer service and database metadata disagree")
    if upload["state"] == "ready":
        return dict(upload["receipt"])

    storage_key = record.get("storage_key")
    if status == "rejected":
        file_id = upload.get("repository_file_id")
        if file_id is None:
            raise RuntimeError("rejected transfer is not bound to a repository file")
        receipt = {
            "protocol": "tus-1.0.0",
            "transfer_id": str(upload_id),
            "file_id": str(file_id),
            "sha256": actual_sha256,
            "size_bytes": length,
            "recovered_after_rejection": True,
        }
        database.reject_resumable_upload(
            upload_id,
            file_id,
            "security_or_format_gate_failed",
            receipt,
        )
        raise UploadRejected([])
    if status == "available":
        if not isinstance(storage_key, str) or not storage_key.startswith("objects/sha256/"):
            raise RuntimeError("available transfer omitted its immutable storage key")
        file_id = upload.get("repository_file_id")
        if file_id is None:
            raise RuntimeError("available transfer is not bound to a repository file")
        target = (settings.storage_root / storage_key).resolve()
        if not target.is_relative_to(settings.storage_root) or not target.is_file():
            raise RuntimeError("promoted transfer object is missing")
        stored = StoredObject(actual_sha256, storage_key, target)
        receipt = {
            "protocol": "tus-1.0.0",
            "transfer_id": str(upload_id),
            "file_id": str(file_id),
            "sha256": actual_sha256,
            "size_bytes": length,
            "storage_key": storage_key,
            "integrity": "sha256_verified",
            "recovered_after_promotion": True,
        }
        database.complete_resumable_upload(upload_id, file_id, stored, length, receipt)
        return receipt
    if status != "uploaded":
        raise RuntimeError("transfer bytes are not ready for quarantine scanning")

    payload = (settings.storage_root / "transfers" / str(upload_id) / "payload").resolve()
    expected_parent = (settings.storage_root / "transfers" / str(upload_id)).resolve()
    if payload.parent != expected_parent or not payload.is_file() or payload.is_symlink():
        raise RuntimeError("transfer quarantine payload is missing or unsafe")
    if payload.stat().st_size != length:
        raise RuntimeError("transfer quarantine size does not match its receipt")

    staged = StagedObject(
        upload_id=upload_id,
        path=repository_path,
        size_bytes=length,
        mime_type=str(record.get("mime_type") or "application/octet-stream")[:255],
        sha256=actual_sha256,
        storage_key=f"quarantine/transfers/{upload_id}/payload",
        absolute_path=payload,
    )
    _upload, file_id = database.prepare_resumable_scan(upload_id, staged)
    results = _scan_staged(staged, settings)
    _record_results(database, file_id, results)
    receipt = {
        "protocol": "tus-1.0.0",
        "transfer_id": str(upload_id),
        "file_id": str(file_id),
        "sha256": actual_sha256,
        "size_bytes": length,
        "inspections": [asdict(result) for result in results],
    }

    if any(result.status == "failed" for result in results):
        rejected = request_transfer_sync(
            settings,
            "POST",
            f"/v1/transfers/{upload_id}/reject",
        )
        if rejected.status_code >= 300:
            raise RuntimeError("failed transfer could not be removed from quarantine")
        database.reject_resumable_upload(
            upload_id,
            file_id,
            "security_or_format_gate_failed",
            receipt,
        )
        raise UploadRejected(results)
    if any(result.status == "error" for result in results):
        database.hold_resumable_upload(
            upload_id,
            file_id,
            "required_scanner_error",
            receipt,
        )
        raise UploadHeld(results)

    promoted = request_transfer_sync(
        settings,
        "POST",
        f"/v1/transfers/{upload_id}/promote",
    )
    if promoted.status_code >= 300:
        raise RuntimeError("clean transfer could not be promoted into immutable storage")
    promotion = promoted.json()
    promoted_key = promotion.get("storage_key")
    if (
        promotion.get("status") != "available"
        or promotion.get("actual_sha256") != actual_sha256
        or not isinstance(promoted_key, str)
        or not promoted_key.startswith("objects/sha256/")
    ):
        raise RuntimeError("transfer promotion receipt is invalid")
    target = (settings.storage_root / promoted_key).resolve()
    if not target.is_relative_to(settings.storage_root) or not target.is_file():
        raise RuntimeError("promoted content-addressed object is missing")
    receipt.update(
        {
            "storage_key": promoted_key,
            "integrity": "sha256_verified",
        }
    )
    stored = StoredObject(actual_sha256, promoted_key, target)
    database.complete_resumable_upload(upload_id, file_id, stored, length, receipt)
    return {
        "file_id": str(file_id),
        "repository_id": str(repository_id),
        "revision_id": str(revision_id),
        "path": repository_path,
        "size_bytes": length,
        "mime_type": staged.mime_type,
        "sha256": actual_sha256,
        "storage_state": "available",
        "scan_status": "clean",
        "receipt": receipt,
    }
