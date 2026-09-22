from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any
from uuid import UUID

from .database import RevisionFile
from .inspectors.gguf import inspect_gguf, write_vocab_only_gguf
from .inspectors.tokenizers import (
    VERIFICATION_TEXTS,
    decode_token_ids,
    export_portable_tokenizer,
    inspect_tokenizer,
    tokenize_text,
    tokenizer_verification_vectors,
)
from .runtimes.llama_tokenizer import LlamaTokenizerPool
from .settings import Settings

PACK_VERSION = "superii-tokenizer-pack-v1"
MAX_PACK_BYTES = 256 * 1024**2
TOKENIZER_FILENAMES = frozenset(
    {
        "added_tokens.json",
        "chat_template.jinja",
        "config.json",
        "generation_config.json",
        "merges.txt",
        "sentencepiece.bpe.model",
        "special_tokens_map.json",
        "spiece.model",
        "tokenizer.json",
        "tokenizer.model",
        "tokenizer_config.json",
        "vocab.json",
        "vocab.txt",
    }
)
LICENSE_FILENAMES = frozenset(
    {"license", "license.md", "license.txt", "notice", "notice.md", "notice.txt"}
)


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _safe_context_from_gguf(inspection: dict[str, Any]) -> int | None:
    metadata = inspection.get("metadata")
    if not isinstance(metadata, dict):
        return None
    for key, value in metadata.items():
        if key.endswith(".context_length") and type(value) is int and 0 < value <= 10_000_000:
            return int(value)
    return None


def _gguf_vocab_size(inspection: dict[str, Any]) -> int | None:
    metadata = inspection.get("metadata")
    if not isinstance(metadata, dict):
        return None
    tokens = metadata.get("tokenizer.ggml.tokens")
    if isinstance(tokens, dict) and type(tokens.get("count")) is int:
        return int(tokens["count"])
    return None


def _gguf_tokenizer_format(inspection: dict[str, Any]) -> str:
    metadata = inspection.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("tokenizer.ggml.model"), str):
        return str(metadata["tokenizer.ggml.model"])
    return "gguf"


def _gguf_special_tokens(inspection: dict[str, Any]) -> dict[str, int]:
    metadata = inspection.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    result: dict[str, int] = {}
    for key, value in metadata.items():
        if key.startswith("tokenizer.ggml.") and key.endswith("_token_id") and type(value) is int:
            result[key.removeprefix("tokenizer.ggml.")] = int(value)
    return result


class TokenizerPackStore:
    def __init__(self, settings: Settings, llama_pool: LlamaTokenizerPool) -> None:
        self.settings = settings
        self.llama_pool = llama_pool
        self.root = (settings.storage_root / "tokenizer-packs").resolve()
        self.root.mkdir(mode=0o750, parents=True, exist_ok=True)
        self._verification_lock = threading.RLock()
        self._verified_pack_stats: dict[tuple[str, str], tuple[tuple[Any, ...], ...]] = {}

    def build(
        self,
        *,
        repository_id: UUID,
        revision_id: UUID,
        workspace: Path,
        files: list[RevisionFile],
    ) -> dict[str, Any]:
        gguf_files = [file for file in files if file.path.lower().endswith(".gguf")]
        if gguf_files:
            # Split GGUF revisions use the first shard as the vocabulary authority.
            source = sorted(gguf_files, key=lambda item: item.path)[0]
            return self._build_gguf(repository_id, revision_id, workspace, source)
        return self._build_huggingface(repository_id, revision_id, workspace, files)

    def encode(
        self,
        manifest: dict[str, Any],
        text: str,
        *,
        add_special_tokens: bool,
    ) -> dict[str, Any]:
        pack_root = self._validated_pack_root(manifest)
        engine = manifest.get("engine")
        if engine == "huggingface-tokenizers":
            result = tokenize_text(pack_root, text, add_special_tokens)
        elif engine == "llama.cpp":
            special_ids = {
                int(value)
                for value in (manifest.get("special_tokens") or {}).values()
                if type(value) is int
            }
            result = self.llama_pool.encode(
                pack_root / "tokenizer.gguf",
                str(manifest["pack_sha256"]),
                text,
                add_special_tokens=add_special_tokens,
                special_token_ids=special_ids,
                settings=self.settings,
            )
            result["context_length"] = manifest.get("context_length")
        else:
            raise ValueError("tokenizer pack engine is unsupported")
        return {
            **result,
            "pack_sha256": manifest["pack_sha256"],
            "pack_version": PACK_VERSION,
            "revision_id": manifest["source_revision_id"],
            "verified": True,
        }

    def decode(
        self,
        manifest: dict[str, Any],
        token_ids: list[int],
        *,
        skip_special_tokens: bool,
    ) -> dict[str, Any]:
        pack_root = self._validated_pack_root(manifest)
        engine = manifest.get("engine")
        if engine == "huggingface-tokenizers":
            result = decode_token_ids(
                pack_root,
                token_ids,
                skip_special_tokens=skip_special_tokens,
            )
        elif engine == "llama.cpp":
            special_ids = {
                int(value)
                for value in (manifest.get("special_tokens") or {}).values()
                if type(value) is int
            }
            result = self.llama_pool.decode(
                pack_root / "tokenizer.gguf",
                str(manifest["pack_sha256"]),
                token_ids,
                skip_special_tokens=skip_special_tokens,
                special_token_ids=special_ids,
                settings=self.settings,
            )
        else:
            raise ValueError("tokenizer pack engine is unsupported")
        return {
            **result,
            "pack_sha256": manifest["pack_sha256"],
            "pack_version": PACK_VERSION,
            "revision_id": manifest["source_revision_id"],
            "verified": True,
        }

    def artifact(self, manifest: dict[str, Any], path: str) -> tuple[Path, dict[str, Any]]:
        pack_root = self._validated_pack_root(manifest)
        artifact = next(
            (
                item
                for item in manifest.get("artifacts", [])
                if isinstance(item, dict) and item.get("path") == path
            ),
            None,
        )
        if artifact is None:
            raise FileNotFoundError("tokenizer pack artifact not found")
        target = (pack_root / Path(*path.split("/"))).resolve(strict=True)
        if not target.is_relative_to(pack_root) or not target.is_file() or target.is_symlink():
            raise FileNotFoundError("tokenizer pack artifact not found")
        if target.stat().st_size != artifact.get("size_bytes") or _sha256(target) != artifact.get(
            "sha256"
        ):
            raise RuntimeError("tokenizer pack artifact failed integrity verification")
        return target, artifact

    def _build_huggingface(
        self,
        repository_id: UUID,
        revision_id: UUID,
        workspace: Path,
        files: list[RevisionFile],
    ) -> dict[str, Any]:
        inspection = inspect_tokenizer(workspace)
        reference_vectors = tokenizer_verification_vectors(workspace)
        selected = [
            file
            for file in files
            if Path(file.path).name.lower() in TOKENIZER_FILENAMES
            or ("/" not in file.path and Path(file.path).name.lower() in LICENSE_FILENAMES)
        ]
        if not selected:
            raise ValueError("tokenizer source files are required")
        if sum(file.size_bytes for file in selected) > MAX_PACK_BYTES:
            raise ValueError("tokenizer pack exceeds the 256 MiB safety limit")

        staging = self._staging(revision_id)
        try:
            source_by_path = {file.path: file for file in selected}
            for file in sorted(selected, key=lambda item: item.path):
                source = (workspace / Path(*file.path.split("/"))).resolve(strict=True)
                if (
                    not source.is_relative_to(workspace)
                    or not source.is_file()
                    or source.is_symlink()
                ):
                    raise ValueError("tokenizer artifact path is unsafe")
                target = staging / Path(*file.path.split("/"))
                target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                if target.stat().st_size != file.size_bytes or _sha256(target) != file.sha256:
                    raise RuntimeError("copied tokenizer artifact failed verification")
            export_portable_tokenizer(workspace, staging)
            artifacts: list[dict[str, Any]] = []
            staging_root = staging.resolve()
            for target in sorted(path for path in staging.rglob("*") if path.is_file()):
                if target.is_symlink() or not target.resolve().is_relative_to(staging_root):
                    raise ValueError("generated tokenizer artifact path is unsafe")
                relative = target.relative_to(staging).as_posix()
                target.chmod(0o440)
                source_record = source_by_path.get(relative)
                artifacts.append(
                    {
                        "path": relative,
                        "sha256": _sha256(target),
                        "size_bytes": target.stat().st_size,
                        "source_path": source_record.path if source_record else None,
                        "generated": source_record is None,
                    }
                )
            if sum(item["size_bytes"] for item in artifacts) > MAX_PACK_BYTES:
                raise ValueError("generated tokenizer pack exceeds the 256 MiB safety limit")
            vectors = tokenizer_verification_vectors(staging)
            if vectors != reference_vectors:
                raise RuntimeError(
                    "portable tokenizer pack differs from the immutable source tokenizer"
                )
            base = {
                "version": PACK_VERSION,
                "repository_id": str(repository_id),
                "source_revision_id": str(revision_id),
                "engine": "huggingface-tokenizers",
                "engine_version": _package_version("tokenizers"),
                "converter_versions": {
                    "transformers": _package_version("transformers"),
                    "sentencepiece": _package_version("sentencepiece"),
                    "tiktoken": _package_version("tiktoken"),
                },
                "format": "tokenizer.json",
                "tokenizer_class": inspection["class"],
                "vocabulary_size": inspection["vocabulary_size"],
                "context_length": inspection["model_max_length"],
                "special_tokens": inspection["special_tokens"],
                "chat_template": inspection["chat_template"],
                "browser_compatible": True,
                "offline": True,
                "trust_remote_code": False,
                "artifacts": artifacts,
                "source_files": [
                    {"path": file.path, "sha256": file.sha256, "size_bytes": file.size_bytes}
                    for file in sorted(selected, key=lambda item: item.path)
                ],
                "verification_vectors": vectors,
                "verification": {
                    "encode": "passed",
                    "decode": "passed",
                    "unicode": "passed",
                    "reference": "immutable source through pinned native engine",
                },
                "integrity": "sha256-content-addressed",
            }
            return self._promote(staging, base)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def _build_gguf(
        self,
        repository_id: UUID,
        revision_id: UUID,
        workspace: Path,
        source_file: RevisionFile,
    ) -> dict[str, Any]:
        source = (workspace / Path(*source_file.path.split("/"))).resolve(strict=True)
        if not source.is_relative_to(workspace) or not source.is_file() or source.is_symlink():
            raise ValueError("GGUF tokenizer source path is unsafe")
        inspection = inspect_gguf(source)
        staging = self._staging(revision_id)
        try:
            artifact = staging / "tokenizer.gguf"
            write_vocab_only_gguf(source, artifact)
            if artifact.stat().st_size > MAX_PACK_BYTES:
                raise ValueError("GGUF tokenizer pack exceeds the 256 MiB safety limit")
            artifact_sha256 = _sha256(artifact)
            preliminary = hashlib.sha256(
                _canonical(
                    {
                        "version": PACK_VERSION,
                        "source_revision_id": str(revision_id),
                        "source_sha256": source_file.sha256,
                        "artifact_sha256": artifact_sha256,
                    }
                )
            ).hexdigest()
            special_ids = set(_gguf_special_tokens(inspection).values())
            reference_vectors: list[dict[str, Any]] = []
            for name, text in VERIFICATION_TEXTS:
                encoded = self.llama_pool.encode(
                    source,
                    source_file.sha256,
                    text,
                    add_special_tokens=False,
                    special_token_ids=special_ids,
                    settings=self.settings,
                )
                reference_vectors.append(
                    {
                        "name": name,
                        "text": text,
                        "add_special_tokens": False,
                        "token_ids": encoded["token_ids"],
                        "decoded_sha256": encoded["decoded_sha256"],
                    }
                )
            vectors: list[dict[str, Any]] = []
            for name, text in VERIFICATION_TEXTS:
                encoded = self.llama_pool.encode(
                    artifact,
                    preliminary,
                    text,
                    add_special_tokens=False,
                    special_token_ids=special_ids,
                    settings=self.settings,
                )
                vectors.append(
                    {
                        "name": name,
                        "text": text,
                        "add_special_tokens": False,
                        "token_ids": encoded["token_ids"],
                        "decoded_sha256": encoded["decoded_sha256"],
                    }
                )
            if vectors != reference_vectors:
                raise RuntimeError(
                    "GGUF tokenizer pack differs from the immutable source vocabulary"
                )
            base = {
                "version": PACK_VERSION,
                "repository_id": str(repository_id),
                "source_revision_id": str(revision_id),
                "engine": "llama.cpp",
                "engine_version": self.settings.llama_cpp_version,
                "converter_versions": {"llama.cpp": self.settings.llama_cpp_version},
                "format": _gguf_tokenizer_format(inspection),
                "tokenizer_class": "GGUF vocabulary",
                "vocabulary_size": _gguf_vocab_size(inspection),
                "context_length": _safe_context_from_gguf(inspection),
                "special_tokens": _gguf_special_tokens(inspection),
                "chat_template": "tokenizer.chat_template" in inspection.get("metadata", {}),
                "browser_compatible": False,
                "offline": True,
                "trust_remote_code": False,
                "artifacts": [
                    {
                        "path": "tokenizer.gguf",
                        "sha256": artifact_sha256,
                        "size_bytes": artifact.stat().st_size,
                        "source_path": source_file.path,
                    }
                ],
                "source_files": [
                    {
                        "path": source_file.path,
                        "sha256": source_file.sha256,
                        "size_bytes": source_file.size_bytes,
                    }
                ],
                "verification_vectors": vectors,
                "verification": {
                    "encode": "passed",
                    "decode": "passed",
                    "unicode": "passed",
                    "reference": "immutable source through pinned llama.cpp vocabulary engine",
                },
                "integrity": "sha256-content-addressed",
            }
            return self._promote(staging, base)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def _staging(self, revision_id: UUID) -> Path:
        parent = self.root / str(revision_id)
        parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        staging = parent / f".staging-{uuid.uuid4().hex}"
        staging.mkdir(mode=0o750)
        return staging

    def _promote(self, staging: Path, base: dict[str, Any]) -> dict[str, Any]:
        pack_sha256 = hashlib.sha256(_canonical(base)).hexdigest()
        manifest = {**base, "pack_sha256": pack_sha256}
        manifest_path = staging / "manifest.json"
        manifest_path.write_bytes(_canonical(manifest) + b"\n")
        manifest_path.chmod(0o440)
        final = staging.parent / pack_sha256
        if not final.exists():
            try:
                os.replace(staging, final)
            except OSError:
                # Another runtime process may have promoted the identical pack
                # between the existence check and rename.
                if not final.exists():
                    raise
                shutil.rmtree(staging, ignore_errors=True)
            else:
                for directory in (path for path in final.rglob("*") if path.is_dir()):
                    directory.chmod(0o550)
                final.chmod(0o550)
        else:
            shutil.rmtree(staging)
        stored_manifest = final / "manifest.json"
        if (
            final.is_symlink()
            or not final.is_dir()
            or not stored_manifest.is_file()
            or stored_manifest.is_symlink()
            or json.loads(stored_manifest.read_text(encoding="utf-8")) != manifest
        ):
            raise RuntimeError("existing tokenizer pack does not match its content hash")
        return manifest

    def _validated_pack_root(self, manifest: dict[str, Any]) -> Path:
        if manifest.get("version") != PACK_VERSION:
            raise ValueError("tokenizer pack version is unsupported")
        pack_sha256 = manifest.get("pack_sha256")
        revision_id = manifest.get("source_revision_id")
        if not isinstance(pack_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", pack_sha256):
            raise ValueError("tokenizer pack hash is invalid")
        try:
            UUID(str(revision_id))
        except ValueError as error:
            raise ValueError("tokenizer pack revision is invalid") from error
        expected = dict(manifest)
        expected.pop("pack_sha256", None)
        if hashlib.sha256(_canonical(expected)).hexdigest() != pack_sha256:
            raise ValueError("tokenizer pack manifest failed integrity verification")
        candidate = self.root / str(revision_id) / pack_sha256
        if candidate.is_symlink():
            raise RuntimeError("tokenizer pack directory must not be a symlink")
        pack_root = candidate.resolve(strict=True)
        if not pack_root.is_relative_to(self.root) or not pack_root.is_dir():
            raise FileNotFoundError("tokenizer pack is not materialized")
        stored_manifest = pack_root / "manifest.json"
        if not stored_manifest.is_file() or stored_manifest.is_symlink():
            raise RuntimeError("tokenizer pack manifest is missing")
        if json.loads(stored_manifest.read_text(encoding="utf-8")) != manifest:
            raise RuntimeError("stored tokenizer pack manifest does not match the signed record")
        self._verify_artifacts(pack_root, manifest)
        return pack_root

    def _verify_artifacts(self, pack_root: Path, manifest: dict[str, Any]) -> None:
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts or len(artifacts) > 10_000:
            raise ValueError("tokenizer pack artifact manifest is invalid")
        current: list[tuple[Any, ...]] = []
        targets: list[tuple[Path, dict[str, Any]]] = []
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                raise ValueError("tokenizer pack artifact manifest is invalid")
            path = artifact.get("path")
            digest = artifact.get("sha256")
            size = artifact.get("size_bytes")
            if (
                not isinstance(path, str)
                or not path
                or "\\" in path
                or any(part in {"", ".", ".."} for part in path.split("/"))
                or not isinstance(digest, str)
                or not re.fullmatch(r"[a-f0-9]{64}", digest)
                or type(size) is not int
                or size < 0
            ):
                raise ValueError("tokenizer pack artifact manifest is invalid")
            target = pack_root.joinpath(*path.split("/"))
            if target.is_symlink():
                raise RuntimeError("tokenizer pack artifact must not be a symlink")
            resolved = target.resolve(strict=True)
            if not resolved.is_relative_to(pack_root) or not resolved.is_file():
                raise RuntimeError("tokenizer pack artifact path is invalid")
            stat = resolved.stat()
            if stat.st_size != size:
                raise RuntimeError("tokenizer pack artifact failed integrity verification")
            current.append((path, stat.st_ino, stat.st_size, stat.st_mtime_ns, digest))
            targets.append((resolved, artifact))

        key = (str(manifest["source_revision_id"]), str(manifest["pack_sha256"]))
        snapshot = tuple(current)
        with self._verification_lock:
            if self._verified_pack_stats.get(key) == snapshot:
                return
            for target, artifact in targets:
                if _sha256(target) != artifact["sha256"]:
                    raise RuntimeError("tokenizer pack artifact failed integrity verification")
            self._verified_pack_stats[key] = snapshot
