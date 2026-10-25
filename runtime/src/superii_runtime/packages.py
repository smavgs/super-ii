"""Deterministic, seekable TAR delivery without buffering an entire release."""

from __future__ import annotations

import hashlib
import json
import re
import tarfile
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anyio import to_thread

from .database import RevisionFile
from .storage import ObjectStore, normalize_repository_path

CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True, slots=True)
class PackagePart:
    start: int
    size: int
    data: bytes | None = None
    path: Path | None = None
    sha256: str | None = None


@dataclass(frozen=True, slots=True)
class Package:
    parts: tuple[PackagePart, ...]
    size: int
    etag: str


def make_package(
    files: list[RevisionFile], release: Mapping[str, Any], store: ObjectStore
) -> Package:
    if not 1 <= len(files) <= 5000:
        raise ValueError("package file count is out of bounds")
    if len(files) != release["file_count"] or sum(f.size_bytes for f in files) != int(
        release["total_size_bytes"]
    ):
        raise ValueError("complete published package is unavailable")
    paths = {file.path for file in files}
    if len(paths) != len(files):
        raise ValueError("duplicate package path")
    for file in files:
        if normalize_repository_path(file.path) != file.path or re.match(r"^[A-Za-z]:", file.path):
            raise ValueError("unsafe package path")
        pieces = file.path.split("/")
        if any("/".join(pieces[:n]) in paths for n in range(1, len(pieces))):
            raise ValueError("file and directory paths conflict")
        if file.size_bytes < 0 or not re.fullmatch(r"[a-f0-9]{64}", file.sha256):
            raise ValueError("invalid package file metadata")

    parts: list[PackagePart] = []
    offset = 0
    identity = hashlib.sha256()

    def add(data: bytes | None, size: int, path: Path | None = None, sha: str | None = None):
        nonlocal offset
        parts.append(PackagePart(offset, size, data, path, sha))
        offset += size
        # Length-delimited identity binds every header, file hash and metadata byte.
        identity.update(f"{size}:".encode())
        identity.update(b"data:" + data if data is not None else f"sha256:{sha}".encode())

    def header(name: str, size: int):
        info = tarfile.TarInfo(name)
        info.size, info.mode, info.mtime = size, 0o644, 0
        info.uname = info.gname = "superii"
        value = info.tobuf(format=tarfile.PAX_FORMAT, encoding="utf-8")
        add(value, len(value))

    def padding(size: int):
        length = -size % 512
        if length:
            add(bytes(length), length)

    for file in sorted(files, key=lambda f: f.path):
        path = store.resolve_key(file.storage_key)
        if not path.is_file() or path.stat().st_size != file.size_bytes:
            raise ValueError("stored package file is unavailable")
        header(file.path, file.size_bytes)
        add(None, file.size_bytes, path, file.sha256)
        padding(file.size_bytes)

    metadata = {
        "repository": f"{release['owner_handle']}/{release['slug']}",
        "kind": release["kind"],
        "revision": release["commit_sha"],
        "manifest_sha256": release["manifest_sha256"],
        "files": [
            {"path": f.path, "size_bytes": f.size_bytes, "sha256": f.sha256}
            for f in sorted(files, key=lambda f: f.path)
        ],
    }
    name = "SUPERII-RELEASE.json"
    while any(path == name or path.startswith(name + "/") for path in paths):
        name = "_" + name
    content = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode()
    header(name, len(content))
    add(content, len(content))
    padding(len(content))
    add(bytes(1024), 1024)
    return Package(tuple(parts), offset, f'"superii-tar-v1-{identity.hexdigest()}"')


def package_range(value: str | None, size: int) -> tuple[int, int] | None:
    if value is None:
        return (0, size - 1)
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or len(value) > 100:
        return None
    left, right = match.groups()
    if not left:
        length = int(right)
        return (max(0, size - length), size - 1) if length > 0 else None
    start = int(left)
    end = min(int(right), size - 1) if right else size - 1
    return (start, end) if 0 <= start <= end < size else None


def package_bytes(package: Package, bounds: tuple[int, int]) -> Iterator[bytes]:
    start, end = bounds
    for part in package.parts:
        left, right = max(start, part.start), min(end + 1, part.start + part.size)
        if left >= right:
            continue
        begin, remaining = left - part.start, right - left
        if part.data is not None:
            for position in range(begin, begin + remaining, CHUNK_SIZE):
                yield part.data[position : min(position + CHUNK_SIZE, begin + remaining)]
            continue
        if part.path is None:
            raise ValueError("missing package file")
        with part.path.open("rb") as source:
            # Verify the same descriptor that will be delivered. HEAD and header-only
            # ranges do not read model bytes; corrupt content terminates the stream.
            digest = hashlib.sha256()
            size = 0
            while chunk := source.read(CHUNK_SIZE):
                digest.update(chunk)
                size += len(chunk)
            if digest.hexdigest() != part.sha256 or size != part.size:
                raise ValueError("stored package file failed integrity verification")
            source.seek(begin)
            while remaining:
                chunk = source.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    raise ValueError("stored package file was truncated")
                remaining -= len(chunk)
                yield chunk


async def stream_package(package: Package, bounds: tuple[int, int]) -> AsyncIterator[bytes]:
    # Run blocking local disk I/O off the event loop, and close open files on
    # disconnect. anyio waits for an in-flight read before cancellation unwinds.
    with closing(package_bytes(package, bounds)) as chunks:
        while (chunk := await to_thread.run_sync(lambda: next(chunks, None))) is not None:
            yield chunk
