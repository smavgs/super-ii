from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import httpx
from filelock import FileLock

from .attestation import verify_attestation
from .errors import IntegrityError, SuperiiError
from .manifest import File, Manifest, origin

CHUNK = 16 * 1024**2


def sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


@dataclass(frozen=True)
class Peer:
    url: str
    token: str = field(repr=False)

    def __post_init__(self) -> None:
        origin(self.url)
        if len(self.token) < 32:
            raise ValueError("Peer token must contain at least 32 characters")


@dataclass(frozen=True)
class Snapshot:
    path: Path
    manifest: Manifest
    files: tuple[str, ...]
    transferred_bytes: int

    def verify(self) -> bool:
        for item in self.manifest.files:
            if item.path not in self.files:
                continue
            local = self.path / item.path
            if (
                local.is_symlink()
                or not local.is_file()
                or not local.resolve().is_relative_to(self.path.resolve())
                or local.stat().st_size != item.size_bytes
                or sha256(local) != item.sha256
            ):
                raise IntegrityError(f"Cached file failed verification: {item.path}")
        return True


class Client:
    def __init__(
        self,
        base_url: str = "https://superii.site",
        *,
        token: str | None = None,
        cache_dir: str | Path | None = None,
        workers: int = 4,
        peers: tuple[Peer, ...] = (),
        trusted_keys: Mapping[str, str] | None = None,
        require_attestation: bool = True,
        transport: httpx.BaseTransport | None = None,
    ):
        if origin(base_url) != base_url.rstrip("/"):
            raise ValueError("base_url must be an origin without a path or query")
        self.base_url = base_url.rstrip("/")
        self.token = token or os.environ.get("SUPERII_TOKEN")
        self.workers = max(1, min(workers, 8))
        self.peers = peers
        self.trusted_keys = trusted_keys
        self.require_attestation = require_attestation
        self.transferred_bytes = 0
        # Separate credentials/origins to prevent cross-account private cache reuse.
        scope = hashlib.sha256(f"{self.base_url}\0{self.token or 'public'}".encode()).hexdigest()
        root = Path(cache_dir or os.environ.get("SUPERII_CACHE", "~/.cache/superii")).expanduser()
        self.cache = root / scope
        self.cache.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.cache, 0o700)
        self.http = httpx.Client(
            timeout=httpx.Timeout(60, connect=15),
            follow_redirects=False,
            transport=transport,
            trust_env=False,
        )

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self.http.close()

    def _headers(self, url: str) -> dict[str, str]:
        if origin(url) != self.base_url:
            raise IntegrityError("Refusing to send repository credentials to another origin")
        result = {"User-Agent": "superii-python/0.2.0", "Accept-Encoding": "identity"}
        if self.token:
            result["Authorization"] = f"Bearer {self.token}"
        return result

    @staticmethod
    def _check(response: httpx.Response) -> None:
        if response.is_redirect:
            raise IntegrityError(
                "Unexpected redirect; credentials and file requests stay on-origin"
            )
        if response.status_code in {401, 403}:
            raise SuperiiError(
                "Access denied. Check repository scope; if an HTML challenge is "
                "returned, the operator must correct the edge machine-access rule."
            )
        if response.status_code == 404:
            raise SuperiiError("Repository, immutable revision, or file is unavailable")
        response.raise_for_status()

    def inspect(
        self, repository: str, *, revision: str | None = None, kind: str = "model"
    ) -> Manifest:
        if kind not in {"model", "dataset"}:
            raise ValueError("SDK acquisition supports model or dataset repositories")
        parts = repository.split("/")
        if len(parts) != 2 or any(not p or p in {".", ".."} for p in parts):
            raise ValueError("Use owner/model")
        collection = "models" if kind == "model" else "datasets"
        url = f"{self.base_url}/api/sdk/{collection}/"
        url += f"{quote(parts[0], safe='')}/{quote(parts[1], safe='')}"
        with self.http.stream(
            "GET",
            url,
            params={"revision": revision} if revision else None,
            headers=self._headers(url),
        ) as response:
            self._check(response)
            if "application/json" not in response.headers.get("content-type", ""):
                raise SuperiiError(
                    "Expected JSON; an edge browser challenge may be blocking the API"
                )
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 16 * 1024**2:
                    raise IntegrityError("Manifest exceeds 16 MiB")
        manifest = Manifest.parse(json.loads(body), self.base_url, revision=revision)
        if manifest.kind != kind:
            raise IntegrityError("Server returned a different repository kind")
        if manifest.repository.casefold() != repository.casefold():
            raise IntegrityError("Server returned a different repository")
        if self.require_attestation or manifest.publication:
            keys = self.trusted_keys
            if keys is None:
                key_url = self.base_url + "/api/publication-keys"
                response = self.http.get(key_url, headers=self._headers(key_url))
                self._check(response)
                if len(response.content) > 64 * 1024:
                    raise IntegrityError("Publication key response is too large")
                keys = {
                    key["id"]: key["public_key"]
                    for key in response.json()["keys"]
                    if key["enabled"]
                }
            verify_attestation(manifest, keys)
        return manifest

    def _range(
        self,
        file: File,
        start: int,
        end: int,
        path: Path,
        *,
        url: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> int:
        expected = end - start + 1
        if path.is_symlink():
            raise IntegrityError("Cache chunk cannot be a symlink")
        offset = path.stat().st_size if path.exists() else 0
        if offset > expected:
            path.unlink()
            offset = 0
        if offset == expected:
            return 0
        request_headers = dict(headers if headers is not None else self._headers(file.download_url))
        request_headers.update(
            {"Range": f"bytes={start + offset}-{end}", "Accept-Encoding": "identity"}
        )
        with self.http.stream("GET", url or file.download_url, headers=request_headers) as response:
            self._check(response)
            content_range = f"bytes {start + offset}-{end}/{file.size_bytes}"
            whole_file = start == 0 and offset == 0 and expected == file.size_bytes
            if response.status_code == 206:
                if response.headers.get("content-range") != content_range:
                    raise IntegrityError("Server returned the wrong byte range")
            elif response.status_code != 200 or not whole_file:
                raise IntegrityError("Server ignored a required Range request")
            if response.headers.get("content-encoding", "identity") != "identity":
                raise IntegrityError("Compressed range responses cannot be safely resumed")
            received = 0
            with path.open("ab") as output:
                for chunk in response.iter_bytes():
                    received += len(chunk)
                    if offset + received > expected:
                        raise IntegrityError("Range response exceeded its declared size")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if offset + received != expected:
                raise IntegrityError("Incomplete response; partial bytes retained for resume")
        return received

    def _object(self, manifest: Manifest, file: File) -> tuple[Path, int]:
        objects = self.cache / "objects"
        objects.mkdir(mode=0o700, exist_ok=True)
        target = objects / file.sha256
        with FileLock(str(target) + ".lock", timeout=300):
            if target.is_symlink():
                raise IntegrityError("Cache object cannot be a symlink")
            if target.is_file():
                if target.stat().st_size == file.size_bytes and sha256(target) == file.sha256:
                    return target, 0
                target.unlink()
            chunks = self.cache / "chunks" / file.sha256
            chunks.mkdir(mode=0o700, parents=True, exist_ok=True)
            transferred = 0
            # Private releases always use canonical authorization and transfer.
            if manifest.visibility == "public":
                for peer in self.peers:
                    temporary = chunks / "peer"
                    try:
                        temporary.unlink(missing_ok=True)
                        transferred += self._range(
                            file,
                            0,
                            file.size_bytes - 1,
                            temporary,
                            url=f"{peer.url.rstrip('/')}/v1/cache/{manifest.repository}/"
                            f"{manifest.revision}/{file.sha256}",
                            headers={"Authorization": f"Bearer {peer.token}"},
                        )
                        if sha256(temporary) != file.sha256:
                            raise IntegrityError("Peer hash mismatch")
                        os.replace(temporary, target)
                        os.chmod(target, 0o400)
                        return target, transferred
                    except (httpx.HTTPError, SuperiiError, OSError):
                        temporary.unlink(missing_ok=True)
            ranges = [
                (start, min(start + CHUNK, file.size_bytes) - 1)
                for start in range(0, file.size_bytes, CHUNK)
            ]
            try:
                with ThreadPoolExecutor(max_workers=self.workers) as pool:
                    futures = [
                        pool.submit(self._range, file, start, end, chunks / str(start))
                        for start, end in ranges
                    ]
                    for future in futures:
                        transferred += future.result()
                temporary = chunks / "assembled"
                with temporary.open("wb") as output:
                    for start, _ in ranges:
                        with (chunks / str(start)).open("rb") as source:
                            shutil.copyfileobj(source, output)
                    output.flush()
                    os.fsync(output.fileno())
                if temporary.stat().st_size != file.size_bytes or sha256(temporary) != file.sha256:
                    shutil.rmtree(chunks)
                    raise IntegrityError(f"SHA-256 mismatch: {file.path}; corrupt chunks discarded")
                os.replace(temporary, target)
                os.chmod(target, 0o400)
                shutil.rmtree(chunks)
                return target, transferred
            except Exception:
                (chunks / "assembled").unlink(missing_ok=True)
                raise

    def pull(
        self,
        repository: str,
        *,
        revision: str | None = None,
        files: tuple[str, ...] | None = None,
        kind: str = "model",
    ) -> Snapshot:
        # Fetch a fresh authorized manifest even on cache hits (visibility/revocation).
        manifest = self.inspect(repository, revision=revision, kind=kind)
        selected = tuple(f.path for f in manifest.files) if files is None else files
        if not selected or not set(selected) <= {f.path for f in manifest.files}:
            raise IntegrityError("Requested files are not present in the immutable manifest")
        subset = hashlib.sha256("\0".join(sorted(selected)).encode()).hexdigest()[:16]
        folder = self.cache / "snapshots" / manifest.manifest_sha256 / subset
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        transferred = 0
        with FileLock(str(folder) + ".lock", timeout=300):
            for file in manifest.files:
                if file.path not in selected:
                    continue
                source, count = self._object(manifest, file)
                transferred += count
                target = folder / file.path
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if target.is_symlink() or not target.resolve().is_relative_to(folder.resolve()):
                    raise IntegrityError("Snapshot target escapes cache")
                if target.exists():
                    target.unlink()
                # A user mutating a snapshot cannot silently corrupt the shared CAS.
                shutil.copyfile(source, target)
                os.chmod(target, 0o400)
        self.transferred_bytes += transferred
        snapshot = Snapshot(folder, manifest, selected, transferred)
        snapshot.verify()
        return snapshot

    async def apull(
        self,
        repository: str,
        *,
        revision: str | None = None,
        files: tuple[str, ...] | None = None,
        kind: str = "model",
    ) -> Snapshot:
        return await asyncio.to_thread(
            self.pull, repository, revision=revision, files=files, kind=kind
        )

    def prefetch(
        self, repository: str, *, revision: str | None = None, kind: str = "model"
    ) -> Snapshot:
        return self.pull(repository, revision=revision, kind=kind)
