from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path
from uuid import uuid4

import pytest
from tokenizers import Tokenizer, models, pre_tokenizers
from transformers import PreTrainedTokenizerFast

from superii_runtime.database import RevisionFile
from superii_runtime.inspectors.gguf import inspect_gguf, write_vocab_only_gguf
from superii_runtime.inspectors.tokenizers import (
    decode_token_ids,
    inspect_tokenizer,
    tokenize_text,
    tokenizer_verification_vectors,
)
from superii_runtime.runtimes.llama_tokenizer import LlamaTokenizerPool
from superii_runtime.settings import Settings
from superii_runtime.tokenizer_packs import TokenizerPackStore


def _wordlevel_tokenizer(root: Path) -> None:
    vocabulary = {
        "[UNK]": 0,
        "[CLS]": 1,
        "[SEP]": 2,
        "Super": 3,
        "ii": 4,
        "makes": 5,
        "AI": 6,
        "work": 7,
        "understandable": 8,
        ".": 9,
        "café": 10,
        "·": 11,
        "Привет": 12,
        "你好": 13,
        "مرحبا": 14,
        "Build": 15,
        "🤖": 16,
        "with": 17,
        "👩🏽‍💻": 18,
        "and": 19,
        "share": 20,
        "it": 21,
        "hello": 22,
        "world": 23,
    }
    raw = Tokenizer(models.WordLevel(vocabulary, unk_token="[UNK]"))  # noqa: S106
    raw.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=raw,
        unk_token="[UNK]",  # noqa: S106
        cls_token="[CLS]",  # noqa: S106
        sep_token="[SEP]",  # noqa: S106
        model_max_length=128,
    )
    tokenizer.save_pretrained(root)
    (root / "config.json").write_text(
        json.dumps({"model_type": "bert", "vocab_size": len(vocabulary)}),
        encoding="utf-8",
    )


def _legacy_wordpiece_tokenizer(root: Path) -> None:
    (root / "vocab.txt").write_text(
        "\n".join(
            [
                "[PAD]",
                "[UNK]",
                "[CLS]",
                "[SEP]",
                "[MASK]",
                "hello",
                "world",
                "super",
                "ii",
                ".",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "config.json").write_text(
        json.dumps({"model_type": "bert", "vocab_size": 10}),
        encoding="utf-8",
    )
    (root / "tokenizer_config.json").write_text(
        json.dumps(
            {
                "tokenizer_class": "BertTokenizer",
                "do_lower_case": True,
                "model_max_length": 64,
            }
        ),
        encoding="utf-8",
    )
    (root / "special_tokens_map.json").write_text(
        json.dumps(
            {
                "unk_token": "[UNK]",
                "sep_token": "[SEP]",
                "pad_token": "[PAD]",
                "cls_token": "[CLS]",
                "mask_token": "[MASK]",
            }
        ),
        encoding="utf-8",
    )


def _revision_files(root: Path):
    repository_id = uuid4()
    revision_id = uuid4()
    files = []
    for path in sorted(root.iterdir()):
        if not path.is_file():
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        files.append(
            RevisionFile(
                id=uuid4(),
                repository_id=repository_id,
                revision_id=revision_id,
                path=path.name,
                size_bytes=len(data),
                mime_type="application/json",
                sha256=digest,
                storage_key=f"objects/sha256/{digest[:2]}/{digest}",
            )
        )
    return repository_id, revision_id, files


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def test_huggingface_tokenizer_returns_ids_offsets_decode_and_vectors(tmp_path: Path) -> None:
    _wordlevel_tokenizer(tmp_path)

    inspection = inspect_tokenizer(tmp_path)
    encoded = tokenize_text(tmp_path, "hello world", False)
    decoded = decode_token_ids(tmp_path, encoded["token_ids"])
    vectors = tokenizer_verification_vectors(tmp_path)

    assert inspection["available"] is True
    assert inspection["model_max_length"] == 128
    assert encoded["token_ids"] == [22, 23]
    assert encoded["pieces"][0]["character_start"] == 0
    assert encoded["pieces"][1]["character_end"] == 11
    assert decoded["text"] == "hello world"
    assert [vector["name"] for vector in vectors] == ["plain", "multilingual", "emoji"]


def test_huggingface_pack_is_content_addressed_and_executable(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _wordlevel_tokenizer(workspace)
    repository_id, revision_id, files = _revision_files(workspace)
    settings = Settings(storage_root=tmp_path / "storage")
    store = TokenizerPackStore(settings, LlamaTokenizerPool())

    manifest = store.build(
        repository_id=repository_id,
        revision_id=revision_id,
        workspace=workspace,
        files=files,
    )
    encoded = store.encode(manifest, "hello world", add_special_tokens=False)
    decoded = store.decode(manifest, encoded["token_ids"], skip_special_tokens=False)
    artifact, record = store.artifact(manifest, "tokenizer.json")
    rebuilt = store.build(
        repository_id=repository_id,
        revision_id=revision_id,
        workspace=workspace,
        files=files,
    )

    assert manifest["engine"] == "huggingface-tokenizers"
    assert manifest["browser_compatible"] is True
    assert encoded["pack_sha256"] == manifest["pack_sha256"]
    assert decoded["text"] == "hello world"
    assert hashlib.sha256(artifact.read_bytes()).hexdigest() == record["sha256"]
    assert rebuilt == manifest

    original_artifact = artifact.read_bytes()
    artifact.chmod(0o640)
    artifact.write_bytes(b"[" + original_artifact[1:])
    with pytest.raises(RuntimeError, match="failed integrity verification"):
        store.encode(manifest, "hello world", add_special_tokens=False)
    artifact.write_bytes(original_artifact)
    artifact.chmod(0o440)

    stored_manifest = (
        settings.storage_root
        / "tokenizer-packs"
        / str(revision_id)
        / manifest["pack_sha256"]
        / "manifest.json"
    )
    stored_manifest.chmod(0o640)
    stored_manifest.write_text("{}\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="does not match its content hash"):
        store.build(
            repository_id=repository_id,
            revision_id=revision_id,
            workspace=workspace,
            files=files,
        )


def test_legacy_wordpiece_source_is_converted_to_portable_verified_pack(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _legacy_wordpiece_tokenizer(workspace)
    assert not (workspace / "tokenizer.json").exists()
    repository_id, revision_id, files = _revision_files(workspace)
    store = TokenizerPackStore(
        Settings(storage_root=tmp_path / "storage"),
        LlamaTokenizerPool(),
    )

    manifest = store.build(
        repository_id=repository_id,
        revision_id=revision_id,
        workspace=workspace,
        files=files,
    )
    encoded = store.encode(manifest, "hello world", add_special_tokens=False)
    generated = next(item for item in manifest["artifacts"] if item["path"] == "tokenizer.json")

    assert encoded["token_ids"] == [5, 6]
    assert manifest["format"] == "tokenizer.json"
    assert generated["generated"] is True
    assert generated["source_path"] is None


def test_vocab_only_gguf_copies_metadata_and_omits_tensor_descriptors(tmp_path: Path) -> None:
    source = tmp_path / "model.gguf"
    target = tmp_path / "tokenizer.gguf"
    metadata = _gguf_string("tokenizer.ggml.model") + struct.pack("<I", 8) + _gguf_string("gpt2")
    source.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 1, 1) + metadata)

    result = write_vocab_only_gguf(source, target)
    inspection = inspect_gguf(target)

    assert result["metadata_count"] == 1
    assert inspection["tensor_count"] == 0
    assert inspection["metadata"]["tokenizer.ggml.model"] == "gpt2"


def test_gguf_pack_is_verified_against_source_vocabulary(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "model.gguf"
    metadata = _gguf_string("tokenizer.ggml.model") + struct.pack("<I", 8) + _gguf_string("gpt2")
    source.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + metadata)
    repository_id, revision_id, files = _revision_files(workspace)

    class MatchingPool:
        def encode(self, _artifact, _pack_sha256, text, **_kwargs):
            digest = hashlib.sha256(text.encode()).hexdigest()
            return {"token_ids": [len(text)], "decoded_sha256": digest}

    store = TokenizerPackStore(
        Settings(storage_root=tmp_path / "storage"),
        MatchingPool(),  # type: ignore[arg-type]
    )

    manifest = store.build(
        repository_id=repository_id,
        revision_id=revision_id,
        workspace=workspace,
        files=files,
    )

    assert manifest["engine"] == "llama.cpp"
    assert manifest["verification"]["reference"].startswith("immutable source")


def test_gguf_pack_rejects_vocabulary_that_differs_from_source(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "model.gguf"
    metadata = _gguf_string("tokenizer.ggml.model") + struct.pack("<I", 8) + _gguf_string("gpt2")
    source.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + metadata)
    repository_id, revision_id, files = _revision_files(workspace)

    class DriftingPool:
        def encode(self, artifact, _pack_sha256, text, **_kwargs):
            token_id = len(text) + (1 if artifact.name == "tokenizer.gguf" else 0)
            return {"token_ids": [token_id], "decoded_sha256": "a" * 64}

    store = TokenizerPackStore(
        Settings(storage_root=tmp_path / "storage"),
        DriftingPool(),  # type: ignore[arg-type]
    )

    with pytest.raises(RuntimeError, match="differs from the immutable source"):
        store.build(
            repository_id=repository_id,
            revision_id=revision_id,
            workspace=workspace,
            files=files,
        )


def test_gguf_pack_enforces_generated_artifact_size_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "model.gguf"
    metadata = _gguf_string("tokenizer.ggml.model") + struct.pack("<I", 8) + _gguf_string("gpt2")
    source.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + metadata)
    repository_id, revision_id, files = _revision_files(workspace)
    monkeypatch.setattr("superii_runtime.tokenizer_packs.MAX_PACK_BYTES", 16)
    store = TokenizerPackStore(
        Settings(storage_root=tmp_path / "storage"),
        LlamaTokenizerPool(),
    )

    with pytest.raises(ValueError, match="exceeds the 256 MiB safety limit"):
        store.build(
            repository_id=repository_id,
            revision_id=revision_id,
            workspace=workspace,
            files=files,
        )
