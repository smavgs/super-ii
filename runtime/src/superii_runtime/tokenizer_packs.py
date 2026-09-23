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
from .inspectors.gguf_tokenizers import export_portable_gguf_tokenizer
from .inspectors.tokenizers import (
    VERIFICATION_CASES,
    decode_token_ids,
    export_portable_tokenizer,
    inspect_tokenizer,
    tokenize_text,
    tokenizer_verification_vectors,
)
from .runtimes.llama_tokenizer import LlamaTokenizerVerifier
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
VERIFICATION_STATES = ("encode", "decode", "unicode", "special_tokens")
UPGRADEABLE_MANIFEST_FIELDS = frozenset(
    {
        "converter_versions",
        "engine_version",
        "pack_sha256",
        "verification",
        "verification_vectors",
    }
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


def _gguf_tokenizer_format(inspection: dict[str, Any]) -> str:
    metadata = inspection.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("tokenizer.ggml.model"), str):
        return str(metadata["tokenizer.ggml.model"])
    return "gguf"


def manifest_meets_current_verification(manifest: dict[str, Any]) -> bool:
    verification = manifest.get("verification")
    vectors = manifest.get("verification_vectors")
    expected_cases = [
        (name, add_special_tokens) for name, _, add_special_tokens in VERIFICATION_CASES
    ]
    if not isinstance(verification, dict) or any(
        verification.get(state) != "passed" for state in VERIFICATION_STATES
    ):
        return False
    if not isinstance(vectors, list) or len(vectors) != len(expected_cases):
        return False
    observed_cases: list[tuple[str, bool]] = []
    for vector in vectors:
        if (
            not isinstance(vector, dict)
            or not isinstance(vector.get("name"), str)
            or not isinstance(vector.get("text"), str)
            or type(vector.get("add_special_tokens")) is not bool
            or not isinstance(vector.get("token_ids"), list)
            or not isinstance(vector.get("decoded_sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", vector["decoded_sha256"])
            or any(
                type(token_id) is not int or token_id < 0 or token_id > 2_147_483_647
                for token_id in vector["token_ids"]
            )
        ):
            return False
        observed_cases.append((vector["name"], vector["add_special_tokens"]))
    return observed_cases == expected_cases


def is_safe_verification_metadata_upgrade(
    recorded: dict[str, Any], rebuilt: dict[str, Any]
) -> bool:
    """Allow stronger evidence only when tokenizer bytes and prior vectors are unchanged."""

    if not manifest_meets_current_verification(rebuilt):
        return False
    stable_recorded = {
        key: value for key, value in recorded.items() if key not in UPGRADEABLE_MANIFEST_FIELDS
    }
    stable_rebuilt = {
        key: value for key, value in rebuilt.items() if key not in UPGRADEABLE_MANIFEST_FIELDS
    }
    if stable_recorded != stable_rebuilt:
        return False
    old_vectors = recorded.get("verification_vectors")
    new_vectors = rebuilt.get("verification_vectors")
    if not isinstance(old_vectors, list) or not isinstance(new_vectors, list):
        return False
    new_by_name = {vector.get("name"): vector for vector in new_vectors if isinstance(vector, dict)}
    if not old_vectors or any(
        not isinstance(vector, dict)
        or not isinstance(vector.get("name"), str)
        or new_by_name.get(vector["name"]) != vector
        for vector in old_vectors
    ):
        return False
    old_verification = recorded.get("verification")
    return bool(
        isinstance(old_verification, dict)
        and all(old_verification.get(state) == "passed" for state in VERIFICATION_STATES[:-1])
        and old_verification.get("special_tokens") in (None, "passed")
    )


class TokenizerPackStore:
    def __init__(self, settings: Settings, llama_verifier: LlamaTokenizerVerifier) -> None:
        self.settings = settings
        self.llama_verifier = llama_verifier
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
                    "special_tokens": "passed",
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
            metadata_source = staging / ".source-tokenizer.gguf"
            write_vocab_only_gguf(source, metadata_source)
            if metadata_source.stat().st_size > MAX_PACK_BYTES:
                raise ValueError("GGUF tokenizer pack exceeds the 256 MiB safety limit")
            reference_vectors: list[dict[str, Any]] = []
            for name, text, add_special_tokens in VERIFICATION_CASES:
                token_ids = self.llama_verifier.encode_ids(
                    source,
                    source_file.sha256,
                    text,
                    add_special_tokens=add_special_tokens,
                    settings=self.settings,
                )
                reference_vectors.append(
                    {
                        "name": name,
                        "text": text,
                        "add_special_tokens": add_special_tokens,
                        "token_ids": token_ids,
                    }
                )
            conversion = export_portable_gguf_tokenizer(
                metadata_source,
                staging,
                reference_vectors,
                context_length=_safe_context_from_gguf(inspection),
            )
            metadata_source.unlink()
            portable_inspection = inspect_tokenizer(staging)
            vectors = tokenizer_verification_vectors(staging)
            if any(
                vector["token_ids"] != reference["token_ids"]
                or vector["add_special_tokens"] != reference["add_special_tokens"]
                for vector, reference in zip(vectors, reference_vectors, strict=True)
            ):
                raise RuntimeError("portable GGUF tokenizer differs from pinned llama.cpp")
            artifacts: list[dict[str, Any]] = []
            staging_root = staging.resolve()
            for target in sorted(path for path in staging.rglob("*") if path.is_file()):
                if target.is_symlink() or not target.resolve().is_relative_to(staging_root):
                    raise ValueError("generated tokenizer artifact path is unsafe")
                target.chmod(0o440)
                artifacts.append(
                    {
                        "path": target.relative_to(staging).as_posix(),
                        "sha256": _sha256(target),
                        "size_bytes": target.stat().st_size,
                        "source_path": source_file.path,
                        "generated": True,
                    }
                )
            if sum(item["size_bytes"] for item in artifacts) > MAX_PACK_BYTES:
                raise ValueError("generated tokenizer pack exceeds the 256 MiB safety limit")
            base = {
                "version": PACK_VERSION,
                "repository_id": str(repository_id),
                "source_revision_id": str(revision_id),
                "engine": "huggingface-tokenizers",
                "engine_version": _package_version("tokenizers"),
                "converter_versions": {
                    "gguf": _package_version("gguf"),
                    "llama.cpp": self.settings.llama_cpp_version,
                    "tokenizers": _package_version("tokenizers"),
                    "transformers": _package_version("transformers"),
                },
                "format": "tokenizer.json",
                "source_format": _gguf_tokenizer_format(inspection),
                "source_architecture": conversion["source_architecture"],
                "converter_architecture": conversion["converter_architecture"],
                "converter_variant": conversion["converter_variant"],
                "tokenizer_class": portable_inspection["class"],
                "vocabulary_size": portable_inspection["vocabulary_size"],
                "context_length": portable_inspection["model_max_length"],
                "special_tokens": portable_inspection["special_tokens"],
                "chat_template": portable_inspection["chat_template"],
                "browser_compatible": True,
                "offline": True,
                "trust_remote_code": False,
                "artifacts": artifacts,
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
                    "special_tokens": "passed",
                    "reference": "immutable GGUF source through pinned llama.cpp tokenizer oracle",
                    "portable_conversion": (
                        "native token IDs and exact text matched the deterministic "
                        "verification corpus"
                    ),
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
