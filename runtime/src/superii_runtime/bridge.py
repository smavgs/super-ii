from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import shutil
import signal
import threading
import time
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import UUID

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from huggingface_hub import HfApi, snapshot_download

from .database import RepositoryDatabase
from .pipeline import UploadHeld, UploadRejected, process_upload
from .settings import Settings, get_settings
from .storage import ObjectStore, StorageError, normalize_repository_path

LOGGER = logging.getLogger("superii.bridge")
BRIDGE_AAD = b"superii-bridge-v1"
RETRY_DELAYS = (0, 2, 5)


class BridgeError(RuntimeError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code[:120]
        self.detail = detail[:1_000]
        super().__init__(self.code)


def _log(event: str, **detail: object) -> None:
    safe = {key: value for key, value in detail.items() if value is not None}
    LOGGER.info(json.dumps({"event": event, **safe}, sort_keys=True, default=str))


def _base64url_decode(value: str) -> bytes:
    if not value or any(
        character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        for character in value
    ):
        raise BridgeError("credential_invalid", "The connected account credential is invalid.")
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeError) as error:
        raise BridgeError(
            "credential_invalid", "The connected account credential is invalid."
        ) from error


def decrypt_access_token(settings: Settings, credential: dict[str, Any] | None) -> str | None:
    if credential is None:
        return None
    ciphertext = credential.get("access_token_ciphertext")
    nonce = credential.get("access_token_nonce")
    expires_at = credential.get("token_expires_at")
    if not isinstance(ciphertext, str) or not isinstance(nonce, str) or expires_at is None:
        return None
    if isinstance(expires_at, str):
        with suppress(ValueError):
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if not isinstance(expires_at, datetime):
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        return None
    key = _base64url_decode(settings.require_bridge_token_encryption_key())
    if len(key) != 32:
        raise BridgeError("bridge_key_invalid", "Bridge credential encryption is unavailable.")
    try:
        plaintext = AESGCM(key).decrypt(
            _base64url_decode(nonce),
            _base64url_decode(ciphertext),
            BRIDGE_AAD,
        )
        token = plaintext.decode("utf-8")
    except (ValueError, UnicodeError) as error:
        raise BridgeError(
            "credential_invalid", "The connected account must be reconnected."
        ) from error
    if not token or len(token) > 8_192:
        raise BridgeError("credential_invalid", "The connected account must be reconnected.")
    return token


def _hashes(path: Path, size: int) -> tuple[str, str]:
    sha256 = hashlib.sha256()
    git_sha1 = hashlib.sha1(usedforsecurity=False)
    git_sha1.update(f"blob {size}\0".encode())
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            sha256.update(chunk)
            git_sha1.update(chunk)
    return sha256.hexdigest(), git_sha1.hexdigest()


def _expected_manifest(item: dict[str, Any], settings: Settings) -> dict[str, dict[str, Any]]:
    raw_manifest = item.get("source_manifest")
    if not isinstance(raw_manifest, list) or not raw_manifest:
        raise BridgeError("manifest_invalid", "The provider file manifest is missing.")
    if len(raw_manifest) > settings.bridge_max_files:
        raise BridgeError("file_limit", "The repository exceeds the Bridge file limit.")
    expected: dict[str, dict[str, Any]] = {}
    total = 0
    for raw in raw_manifest:
        if not isinstance(raw, dict):
            raise BridgeError("manifest_invalid", "The provider file manifest is invalid.")
        try:
            path = normalize_repository_path(str(raw.get("path", "")))
            size = int(raw.get("size_bytes", -1))
        except (StorageError, TypeError, ValueError) as error:
            raise BridgeError(
                "manifest_invalid", "The provider file manifest is invalid."
            ) from error
        if path in expected or size < 0 or size > settings.max_upload_bytes:
            raise BridgeError("manifest_invalid", "The provider file manifest is invalid.")
        source_sha256 = raw.get("source_sha256")
        source_oid = raw.get("source_oid")
        if source_sha256 is not None and (
            not isinstance(source_sha256, str)
            or len(source_sha256) != 64
            or any(character not in "0123456789abcdefABCDEF" for character in source_sha256)
        ):
            raise BridgeError("manifest_invalid", "The provider checksum manifest is invalid.")
        if source_oid is not None and (
            not isinstance(source_oid, str)
            or len(source_oid) not in {40, 64}
            or any(character not in "0123456789abcdefABCDEF" for character in source_oid)
        ):
            raise BridgeError("manifest_invalid", "The provider object manifest is invalid.")
        expected[path] = {
            "path": path,
            "size_bytes": size,
            "source_sha256": source_sha256.lower() if isinstance(source_sha256, str) else None,
            "source_oid": source_oid.lower() if isinstance(source_oid, str) else None,
        }
        total += size
    if (
        total != int(item.get("total_size_bytes", -1))
        or total > settings.bridge_max_repository_bytes
    ):
        raise BridgeError("manifest_size_mismatch", "The provider manifest size changed.")
    return expected


def verify_snapshot(
    snapshot: Path,
    expected: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    actual: dict[str, Path] = {}
    for candidate in snapshot.rglob("*"):
        relative = candidate.relative_to(snapshot)
        if relative.parts and relative.parts[0] == ".cache":
            continue
        if candidate.is_symlink():
            raise BridgeError(
                "unsafe_snapshot", "The downloaded snapshot contains a symbolic link."
            )
        if candidate.is_file():
            try:
                path = normalize_repository_path(relative.as_posix())
            except StorageError as error:
                raise BridgeError(
                    "unsafe_snapshot", "The downloaded snapshot contains an unsafe path."
                ) from error
            actual[path] = candidate
    if set(actual) != set(expected):
        raise BridgeError("manifest_changed", "The provider file list changed during import.")
    verified: list[dict[str, Any]] = []
    for path in sorted(expected):
        contract = expected[path]
        candidate = actual[path]
        size = candidate.stat().st_size
        if size != contract["size_bytes"]:
            raise BridgeError("manifest_changed", "A provider file changed size during import.")
        sha256, git_sha1 = _hashes(candidate, size)
        if contract["source_sha256"] and sha256 != contract["source_sha256"]:
            raise BridgeError("checksum_mismatch", "A provider file failed its SHA-256 check.")
        oid = contract["source_oid"]
        if not contract["source_sha256"] and oid and len(oid) == 40 and git_sha1 != oid:
            raise BridgeError(
                "checksum_mismatch", "A provider file failed its source object check."
            )
        if not contract["source_sha256"] and oid and len(oid) == 64 and sha256 != oid:
            raise BridgeError(
                "checksum_mismatch", "A provider file failed its source object check."
            )
        verified.append({**contract, "imported_sha256": sha256})
    return verified


def _download_snapshot(
    item: dict[str, Any],
    expected: dict[str, dict[str, Any]],
    token: str | None,
    target: Path,
) -> Path:
    repo_type = str(item["kind"])
    last_error: Exception | None = None
    for delay in RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        try:
            result = snapshot_download(
                repo_id=str(item["provider_repo_id"]),
                repo_type=repo_type,
                revision=str(item["source_revision"]),
                token=token if token else False,
                local_dir=target,
                allow_patterns=list(expected),
                max_workers=4,
            )
            resolved = Path(result).resolve()
            if resolved != target.resolve():
                raise BridgeError(
                    "snapshot_path_invalid", "The provider returned an invalid snapshot path."
                )
            return resolved
        except BridgeError:
            raise
        except Exception as error:  # provider exceptions vary between client releases
            last_error = error
    raise BridgeError(
        "provider_download_failed", "The provider snapshot could not be downloaded."
    ) from last_error


def _runtime_post(
    settings: Settings, path: str, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    headers = {"x-superii-runtime-token": settings.require_runtime_token()}
    try:
        with httpx.Client(
            base_url=settings.bridge_runtime_url,
            headers=headers,
            follow_redirects=False,
            timeout=httpx.Timeout(900.0, connect=5.0),
            trust_env=False,
        ) as client:
            response = client.post(path, json=payload)
    except httpx.HTTPError as error:
        raise BridgeError(
            "runtime_unavailable", "The offline analysis runtime is unavailable."
        ) from error
    if response.status_code >= 300:
        raise BridgeError(
            "offline_analysis_failed", "The imported revision did not pass offline analysis."
        )
    result = response.json()
    if not isinstance(result, dict):
        raise BridgeError(
            "runtime_response_invalid", "The offline analysis runtime returned an invalid result."
        )
    return result


def _card_markdown(snapshot: Path) -> str:
    readme = snapshot / "README.md"
    if not readme.is_file() or readme.is_symlink() or readme.stat().st_size > 100_000:
        return ""
    return readme.read_text(encoding="utf-8", errors="replace")[:100_000]


def _failure(error: Exception) -> tuple[str, str]:
    if isinstance(error, BridgeError):
        return error.code, error.detail
    if isinstance(error, UploadRejected):
        return "security_gate_failed", "A file failed a required security or format gate."
    if isinstance(error, UploadHeld):
        return (
            "scanner_unavailable",
            "A required scanner could not complete; the revision remains quarantined.",
        )
    if isinstance(error, StorageError):
        return "storage_rejected", "A file did not satisfy the immutable storage contract."
    return "bridge_worker_failed", "The import stopped safely before publication."


class Heartbeat:
    def __init__(self, database: RepositoryDatabase, job_id: UUID) -> None:
        self.database = database
        self.job_id = job_id
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name="bridge-heartbeat")

    def _run(self) -> None:
        while not self.stop_event.wait(30):
            with suppress(Exception):
                self.database.bridge_heartbeat(self.job_id)

    def __enter__(self) -> Heartbeat:
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.stop_event.set()
        self.thread.join(timeout=2)


class BridgeWorker:
    def __init__(self, settings: Settings, database: RepositoryDatabase | None = None) -> None:
        self.settings = settings
        self.database = database or RepositoryDatabase(settings)
        self.store = ObjectStore(settings.storage_root, settings.max_upload_bytes)
        self.stop_event = threading.Event()
        self.temp_root = settings.storage_root / "bridge-temp"
        self.temp_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        os.chmod(self.temp_root, 0o750)

    def stop(self, *_args: object) -> None:
        self.stop_event.set()

    def run(self) -> None:
        recovered = self.database.recover_stale_bridge_imports()
        _log("bridge.started", recovered_jobs=recovered)
        next_recovery = time.monotonic() + 60
        while not self.stop_event.is_set():
            if time.monotonic() >= next_recovery:
                recovered = self.database.recover_stale_bridge_imports()
                if recovered:
                    _log("bridge.recovered", recovered_jobs=recovered)
                next_recovery = time.monotonic() + 60
            job_id = self.database.claim_next_bridge_import()
            if job_id:
                self.process_job(job_id)
                continue
            subscription = self.database.claim_due_bridge_sync()
            if subscription:
                self.process_sync(subscription)
                continue
            self.stop_event.wait(self.settings.bridge_poll_seconds)
        _log("bridge.stopped")

    def process_job(self, job_id: UUID) -> None:
        job = self.database.bridge_job(job_id)
        if job is None:
            return
        credential = self.database.bridge_identity_credential(
            job.get("external_identity_id"),
            job["profile_id"],
        )
        try:
            token = decrypt_access_token(self.settings, credential)
        except Exception as error:
            code, detail = _failure(error)
            while item := self.database.claim_next_bridge_item(job_id):
                self.database.set_bridge_item_state(item["id"], "failed", 0, code, detail)
            return
        _log("job.started", job_id=job_id)
        with Heartbeat(self.database, job_id):
            while not self.stop_event.is_set():
                item = self.database.claim_next_bridge_item(job_id)
                if item is None:
                    break
                self.process_item(job_id, item, token)
        self.database.refresh_bridge_import(job_id)
        if self.stop_event.is_set():
            self.database.release_bridge_import(job_id)
        _log("job.finished", job_id=job_id)

    def process_item(self, job_id: UUID, item: dict[str, Any], token: str | None) -> None:
        item_id = item["id"]
        progress = int(item.get("progress_bytes", 0))
        try:
            expected = _expected_manifest(item, self.settings)
            required = int(item["total_size_bytes"]) + min(int(item["total_size_bytes"]), 1024**3)
            if shutil.disk_usage(self.temp_root).free < required:
                raise BridgeError(
                    "insufficient_storage",
                    "The Bridge host does not have enough free temporary storage.",
                )
            with TemporaryDirectory(prefix=f"{item_id}-", dir=self.temp_root) as temporary:
                snapshot = Path(temporary) / "snapshot"
                snapshot.mkdir(mode=0o750)
                downloaded = _download_snapshot(item, expected, token, snapshot)
                if self.stop_event.is_set():
                    if not self.database.requeue_bridge_item(item_id):
                        raise BridgeError(
                            "worker_stopping", "The Bridge worker stopped before preparation."
                        )
                    return
                if self.database.bridge_cancel_requested(job_id):
                    self.database.set_bridge_item_state(item_id, "cancelled", 0)
                    return
                verified_manifest = verify_snapshot(downloaded, expected)
                card_markdown = _card_markdown(downloaded)
                repository_id, revision_id, already_imported = self.database.prepare_bridge_item(
                    item_id
                )
                if already_imported:
                    self.database.refresh_bridge_import(job_id)
                    return
                progress = 0
                for entry in verified_manifest:
                    if self.database.bridge_cancel_requested(job_id):
                        self.database.set_bridge_item_state(item_id, "cancelled", progress)
                        return
                    source_path = downloaded / Path(*str(entry["path"]).split("/"))
                    with source_path.open("rb") as source:
                        process_upload(
                            source=source,
                            repository_path=str(entry["path"]),
                            mime_type=mimetypes.guess_type(source_path.name)[0],
                            repository_id=repository_id,
                            revision_id=revision_id,
                            created_by=f"bridge:{job_id}",
                            settings=self.settings,
                            database=self.database,
                            store=self.store,
                        )
                    progress += int(entry["size_bytes"])
                    self.database.update_bridge_item_progress(item_id, progress)
                    source_path.unlink(missing_ok=True)
                base = f"/v1/repositories/{repository_id}/revisions/{revision_id}"
                _runtime_post(self.settings, f"{base}/inspect", {"kind": str(item["kind"])})
                _runtime_post(self.settings, f"{base}/finalize")
                self.database.complete_bridge_item(item_id, card_markdown, verified_manifest)
                _log("item.review", job_id=job_id, item_id=item_id)
        except Exception as error:
            code, detail = _failure(error)
            with suppress(Exception):
                self.database.set_bridge_item_state(
                    item_id,
                    "cancelled" if self.database.bridge_cancel_requested(job_id) else "failed",
                    progress,
                    None if self.database.bridge_cancel_requested(job_id) else code,
                    None if self.database.bridge_cancel_requested(job_id) else detail,
                )
            _log("item.failed", job_id=job_id, item_id=item_id, error_code=code)

    def process_sync(self, subscription: dict[str, Any]) -> None:
        subscription_id = subscription["id"]
        try:
            if str(subscription.get("provider")) != "huggingface":
                raise BridgeError(
                    "sync_provider_unsupported", "The sync provider is not supported."
                )
            repo_type = str(subscription["kind"])
            info = HfApi(token=False).repo_info(
                repo_id=str(subscription["provider_repo_id"]),
                repo_type=repo_type,
                files_metadata=True,
                token=False,
            )
            if bool(getattr(info, "private", False)) or bool(getattr(info, "gated", False)):
                raise BridgeError(
                    "sync_public_only", "Automatic sync is limited to public sources."
                )
            revision = str(getattr(info, "sha", "")).lower()
            if len(revision) not in {40, 64} or any(
                character not in "0123456789abcdef" for character in revision
            ):
                raise BridgeError(
                    "sync_revision_invalid", "The provider did not return an exact revision."
                )
            if revision == str(subscription["last_seen_revision"]).lower():
                self.database.record_bridge_sync_result(subscription_id, revision, None)
                return
            preview = self._sync_preview(subscription, info, revision)
            self.database.create_bridge_sync_import(subscription, preview)
            self.database.record_bridge_sync_result(subscription_id, None, None)
            _log("sync.queued", subscription_id=subscription_id)
        except Exception as error:
            code, _detail = _failure(error)
            self.database.record_bridge_sync_result(subscription_id, None, code)
            _log("sync.failed", subscription_id=subscription_id, error_code=code)

    def _sync_preview(
        self,
        subscription: dict[str, Any],
        info: Any,
        revision: str,
    ) -> dict[str, Any]:
        siblings = list(getattr(info, "siblings", []) or [])
        if not siblings or len(siblings) > self.settings.bridge_max_files:
            raise BridgeError(
                "sync_file_limit", "The updated source does not satisfy the file-count limit."
            )
        manifest: list[dict[str, Any]] = []
        total = 0
        largest = 0
        for sibling in siblings:
            try:
                path = normalize_repository_path(str(getattr(sibling, "rfilename", "")))
                size = int(getattr(sibling, "size", -1))
            except (StorageError, TypeError, ValueError) as error:
                raise BridgeError(
                    "sync_manifest_invalid", "The updated source manifest is incomplete."
                ) from error
            if size < 0 or size > self.settings.max_upload_bytes:
                raise BridgeError(
                    "sync_file_limit", "The updated source contains an unsupported file size."
                )
            lfs = getattr(sibling, "lfs", None)
            source_sha256 = getattr(lfs, "sha256", None) if lfs is not None else None
            if isinstance(lfs, dict):
                source_sha256 = lfs.get("sha256")
            manifest.append(
                {
                    "path": path,
                    "size_bytes": size,
                    "source_oid": getattr(sibling, "blob_id", None),
                    "source_sha256": source_sha256,
                }
            )
            total += size
            largest = max(largest, size)
        if total < 1 or total > self.settings.bridge_max_repository_bytes:
            raise BridgeError(
                "sync_repository_limit", "The updated source exceeds the repository size limit."
            )
        card_data = getattr(info, "card_data", None)
        card = card_data.to_dict() if hasattr(card_data, "to_dict") else {}
        license_name = card.get("license") if isinstance(card, dict) else None
        if not isinstance(license_name, str) or not license_name.strip():
            raise BridgeError(
                "sync_license_review", "The updated source requires a new license review."
            )
        source_url = str(subscription["source_url"])
        repo_id = str(subscription["provider_repo_id"])
        return {
            "provider_repo_id": repo_id,
            "source_revision": revision,
            "source_url": source_url,
            "kind": str(subscription["kind"]),
            "title": repo_id.split("/", 1)[-1][:200],
            "summary": "Automatically detected source revision; review is still required.",
            "license": license_name[:120],
            "source_visibility": "public",
            "file_count": len(manifest),
            "total_size_bytes": total,
            "largest_file_bytes": largest,
            "blocked_reason": None,
            "source_metadata": {"automatic_sync": True},
            "source_manifest": manifest,
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    settings.require_database_url()
    settings.require_runtime_token()
    settings.require_bridge_token_encryption_key()
    worker = BridgeWorker(settings)
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run()


if __name__ == "__main__":
    main()
