from __future__ import annotations

import hashlib
import os
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from uuid import UUID, uuid4


class StorageError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class StagedObject:
    upload_id: UUID
    path: str
    size_bytes: int
    mime_type: str
    sha256: str
    storage_key: str
    absolute_path: Path


@dataclass(frozen=True, slots=True)
class StoredObject:
    sha256: str
    storage_key: str
    absolute_path: Path


def normalize_repository_path(raw_path: str) -> str:
    """Return one canonical safe POSIX path, rejecting traversal and aliases."""

    if "\\" in raw_path:
        raise StorageError("repository path must use forward slashes")
    normalized = unicodedata.normalize("NFC", raw_path.strip().replace("\\", "/"))
    candidate = PurePosixPath(normalized)
    if not normalized or normalized.startswith("/"):
        raise StorageError("repository path must be relative")
    if len(normalized.encode("utf-8")) > 1024:
        raise StorageError("repository path exceeds 1024 UTF-8 bytes")
    if any(part in {"", ".", ".."} for part in candidate.parts):
        raise StorageError("repository path contains an unsafe segment")
    if any(ord(character) < 32 or ord(character) == 127 for character in normalized):
        raise StorageError("repository path contains an ASCII control character")
    canonical = candidate.as_posix()
    if canonical != normalized:
        raise StorageError("repository path is not canonical")
    return canonical


class ObjectStore:
    """Content-addressed local storage with a quarantine-first write path."""

    def __init__(self, root: Path, max_upload_bytes: int) -> None:
        self.root = root.resolve()
        self.max_upload_bytes = max_upload_bytes
        self.root.mkdir(mode=0o750, parents=True, exist_ok=True)
        os.chmod(self.root, 0o750)
        self.quarantine_root = self.root / "quarantine"
        self.object_root = self.root / "objects" / "sha256"
        self.workspace_root = self.root / "workspaces"
        for directory in (self.quarantine_root, self.object_root, self.workspace_root):
            directory.mkdir(mode=0o750, parents=True, exist_ok=True)
            os.chmod(directory, 0o750)

    def stage(
        self,
        source: BinaryIO,
        repository_path: str,
        mime_type: str | None,
    ) -> StagedObject:
        safe_path = normalize_repository_path(repository_path)
        upload_id = uuid4()
        quarantine_directory = self.quarantine_root / str(upload_id)
        quarantine_directory.mkdir(mode=0o750, parents=False, exist_ok=False)
        target = quarantine_directory / "payload"
        digest = hashlib.sha256()
        size = 0

        try:
            with target.open("xb") as output:
                os.chmod(target, 0o640)
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.max_upload_bytes:
                        raise StorageError("upload exceeds configured size limit")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        except Exception:
            shutil.rmtree(quarantine_directory, ignore_errors=True)
            raise

        sha256 = digest.hexdigest()
        return StagedObject(
            upload_id=upload_id,
            path=safe_path,
            size_bytes=size,
            mime_type=(mime_type or "application/octet-stream")[:255],
            sha256=sha256,
            storage_key=f"quarantine/{upload_id}/payload",
            absolute_path=target,
        )

    def promote(self, staged: StagedObject) -> StoredObject:
        target_directory = self.object_root / staged.sha256[:2]
        target_directory.mkdir(mode=0o750, parents=True, exist_ok=True)
        target = target_directory / staged.sha256
        if target.exists():
            if self.sha256(target) != staged.sha256:
                raise StorageError("existing object failed content-address verification")
            staged.absolute_path.unlink(missing_ok=True)
        else:
            os.replace(staged.absolute_path, target)
            os.chmod(target, 0o440)
        staged.absolute_path.parent.rmdir()
        return StoredObject(
            sha256=staged.sha256,
            storage_key=f"objects/sha256/{staged.sha256[:2]}/{staged.sha256}",
            absolute_path=target,
        )

    def reject(self, staged: StagedObject) -> None:
        shutil.rmtree(staged.absolute_path.parent, ignore_errors=True)

    def resolve_key(self, storage_key: str) -> Path:
        relative = PurePosixPath(storage_key)
        if relative.is_absolute() or ".." in relative.parts:
            raise StorageError("invalid storage key")
        resolved = (self.root / Path(*relative.parts)).resolve()
        if not resolved.is_relative_to(self.root):
            raise StorageError("storage key escapes storage root")
        return resolved

    @staticmethod
    def sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()
