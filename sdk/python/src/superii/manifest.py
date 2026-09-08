from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlsplit

from .errors import IntegrityError

SHA256 = re.compile(r"^[a-f0-9]{64}$")


def safe_path(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or len(value.encode()) > 1024
        or value.startswith("/")
        or "\\" in value
        or ":" in value
        or path.as_posix() != value
        or any(part in {".", ".."} or part.endswith((" ", ".")) for part in path.parts)
        or any(ord(c) < 32 or ord(c) == 127 for c in value)
        or unicodedata.normalize("NFC", value) != value
    ):
        raise IntegrityError("Manifest contains a non-canonical or unsafe path")
    # Windows device aliases are unsafe even when downloaded on another OS.
    if any(
        re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", p) for p in path.parts
    ):
        raise IntegrityError("Manifest contains a reserved device path")
    return value


def origin(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment:
        raise IntegrityError("URLs must not contain credentials or fragments")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    ):
        raise IntegrityError("HTTPS is required outside loopback")
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass(frozen=True)
class File:
    path: str
    size_bytes: int
    sha256: str
    download_url: str


@dataclass(frozen=True)
class Manifest:
    repository: str
    repository_id: str
    revision: str
    revision_id: str
    manifest_sha256: str
    files: tuple[File, ...]
    visibility: str
    compatibility: dict[str, Any]
    publication: dict[str, Any] | None = None
    kind: str = "model"

    @classmethod
    def parse(cls, data: dict[str, Any], base_url: str, *, revision: str | None = None) -> Manifest:
        try:
            repo, release = data["repository"], data["revision"]
            commit, checksum = release["commit_sha"], release["manifest_sha256"]
            if not SHA256.fullmatch(commit) or not SHA256.fullmatch(checksum):
                raise IntegrityError("Release requires an immutable commit and manifest hash")
            if revision and commit != revision:
                raise IntegrityError("Server returned a different revision than requested")
            files = tuple(
                File(safe_path(f["path"]), int(f["size_bytes"]), f["sha256"], f["download_url"])
                for f in data["files"]
            )
            if not files or len(files) > 20_000:
                raise IntegrityError("Empty or excessive manifest")
            paths: set[str] = set()
            for file in files:
                if file.path.casefold() in paths or file.size_bytes < 0:
                    raise IntegrityError("Ambiguous paths or negative file size")
                paths.add(file.path.casefold())
                if not SHA256.fullmatch(file.sha256):
                    raise IntegrityError("Every file requires a SHA-256 digest")
                if origin(file.download_url) != origin(base_url):
                    raise IntegrityError("Downloads must use the canonical authenticated origin")
            for file in files:
                if any(
                    parent.as_posix().casefold() in paths
                    for parent in PurePosixPath(file.path).parents
                    if str(parent) != "."
                ):
                    raise IntegrityError("Manifest file/directory collision")
            digest = hashlib.sha256()
            for file in sorted(files, key=lambda item: item.path):
                digest.update(f"{file.path}\0{file.sha256}\0{file.size_bytes}\n".encode())
            if digest.hexdigest() != checksum:
                raise IntegrityError("Canonical manifest SHA-256 mismatch")
            if sum(f.size_bytes for f in files) != int(release["total_size_bytes"]):
                raise IntegrityError("Release size does not match manifest")
            visibility = repo["visibility"]
            kind = repo.get("kind", "model")
            if kind not in {"model", "dataset"}:
                raise IntegrityError("Unsupported repository kind")
            if visibility not in {"public", "private"}:
                raise IntegrityError("Unknown repository visibility")
            return cls(
                f"{repo['owner']}/{repo['slug']}",
                repo["id"],
                commit,
                release["id"],
                checksum,
                files,
                visibility,
                data.get("compatibility") or {},
                data.get("publication"),
                kind,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise IntegrityError("Invalid repository manifest") from error
