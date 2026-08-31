from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from uuid import UUID

from .database import RepositoryDatabase
from .storage import ObjectStore, normalize_repository_path
from .workspaces import revision_manifest, revision_manifest_document


class PersistentWorkspaceCache:
    """Materialize immutable revisions once and reuse their verified files safely."""

    def __init__(self, store: ObjectStore) -> None:
        self.store = store
        self.root = store.workspace_root / "cache"
        self.root.mkdir(mode=0o750, parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._registry_lock = threading.Lock()

    def _lock(self, key: str) -> threading.Lock:
        with self._registry_lock:
            return self._locks.setdefault(key, threading.Lock())

    def materialize(self, database: RepositoryDatabase, revision_id: UUID) -> Path:
        files = database.list_revision_files(revision_id)
        if not files:
            raise ValueError("revision has no clean files")
        manifest_sha256 = revision_manifest(files)
        key = f"{revision_id}-{manifest_sha256}"
        target = self.root / key
        manifest = revision_manifest_document(files)
        with self._lock(key):
            if self._valid(target, manifest_sha256, manifest):
                return target
            if target.exists():
                shutil.rmtree(target)
            pending = self.root / f".{key}.{os.getpid()}.pending"
            if pending.exists():
                shutil.rmtree(pending)
            pending.mkdir(mode=0o700, parents=False, exist_ok=False)
            try:
                for file in files:
                    relative = Path(*normalize_repository_path(file.path).split("/"))
                    source = self.store.resolve_key(file.storage_key)
                    if source.is_symlink() or not source.is_file():
                        raise ValueError(f"stored object is missing or unsafe: {file.path}")
                    if (
                        source.stat().st_size != file.size_bytes
                        or self.store.sha256(source) != file.sha256
                    ):
                        raise ValueError(f"stored object failed verification: {file.path}")
                    destination = pending / relative
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    try:
                        os.link(source, destination, follow_symlinks=False)
                    except OSError:
                        shutil.copyfile(source, destination, follow_symlinks=False)
                    os.chmod(destination, 0o440)

                receipt = {
                    "version": 1,
                    "revision_id": str(revision_id),
                    "manifest_sha256": manifest_sha256,
                    "files": manifest,
                }
                receipt_path = pending / ".superii-workspace.json"
                receipt_path.write_text(
                    json.dumps(receipt, sort_keys=True, separators=(",", ":")),
                    encoding="utf-8",
                )
                os.chmod(receipt_path, 0o440)
                for directory, _, _ in os.walk(pending, topdown=False):
                    os.chmod(directory, 0o550)  # noqa: S103
                os.replace(pending, target)
                self._sync_directory(self.root)
            except Exception:
                shutil.rmtree(pending, ignore_errors=True)
                raise
            if not self._valid(target, manifest_sha256, manifest):
                raise RuntimeError("persistent workspace cache failed post-build verification")
            return target

    @staticmethod
    def _valid(target: Path, manifest_sha256: str, manifest: list[dict[str, object]]) -> bool:
        receipt_path = target / ".superii-workspace.json"
        if target.is_symlink() or not target.is_dir() or not receipt_path.is_file():
            return False
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        if receipt.get("manifest_sha256") != manifest_sha256 or receipt.get("files") != manifest:
            return False
        for item in manifest:
            relative = Path(*normalize_repository_path(str(item["path"])).split("/"))
            candidate = target / relative
            if candidate.is_symlink() or not candidate.is_file():
                return False
            if candidate.stat().st_size != int(item["size_bytes"]):
                return False
        return True

    @staticmethod
    def _sync_directory(path: Path) -> None:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
