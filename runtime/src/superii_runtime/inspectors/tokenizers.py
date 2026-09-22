from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

MAX_TOKENIZER_INPUT_CHARACTERS = 100_000
MAX_DECODE_TOKEN_IDS = 100_000
VERIFICATION_TEXTS = (
    ("plain", "Super ii makes AI work understandable."),
    ("multilingual", "café · Привет · 你好 · مرحبا"),
    ("emoji", "Build 🤖 with 👩🏽‍💻 and share it."),
)


def _offline_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


@lru_cache(maxsize=8)
def _load_cached(root_value: str):
    _offline_environment()
    from transformers import AutoTokenizer

    resolved = Path(root_value).resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("tokenizer inspection requires a local directory")
    tokenizer = AutoTokenizer.from_pretrained(
        resolved,
        local_files_only=True,
        trust_remote_code=False,
        use_fast=True,
    )
    if not tokenizer.is_fast:
        raise ValueError("a safe fast tokenizer is required")
    return tokenizer


def _load(root: Path):
    return _load_cached(str(root.resolve(strict=True)))


def tokenizer_cache_info() -> dict[str, int]:
    info = _load_cached.cache_info()
    return {"hits": info.hits, "misses": info.misses, "size": info.currsize, "max_size": 8}


def _context_length(tokenizer: Any) -> int | None:
    value = getattr(tokenizer, "model_max_length", None)
    # Transformers uses very large sentinel integers when no real limit is declared.
    return int(value) if isinstance(value, int) and 0 < value <= 10_000_000 else None


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _byte_offset(value: str, character_offset: int) -> int:
    return len(value[:character_offset].encode("utf-8"))


def _encoded(tokenizer: Any, text: str, add_special_tokens: bool) -> dict[str, Any]:
    encoded = tokenizer(
        text,
        add_special_tokens=add_special_tokens,
        return_attention_mask=False,
        return_offsets_mapping=True,
        return_special_tokens_mask=True,
    )
    token_ids = [int(value) for value in encoded["input_ids"]]
    tokens = [str(value) for value in tokenizer.convert_ids_to_tokens(token_ids)]
    offsets = [(int(start), int(end)) for start, end in encoded["offset_mapping"]]
    special_mask = [bool(value) for value in encoded["special_tokens_mask"]]
    if not (len(token_ids) == len(tokens) == len(offsets) == len(special_mask)):
        raise RuntimeError("tokenizer returned inconsistent token metadata")

    pieces: list[dict[str, Any]] = []
    for token_id, token, (start, end), special in zip(
        token_ids, tokens, offsets, special_mask, strict=True
    ):
        pieces.append(
            {
                "id": token_id,
                "token": token,
                "piece": tokenizer.decode(
                    [token_id],
                    skip_special_tokens=False,
                    clean_up_tokenization_spaces=False,
                ),
                "special": special,
                "character_start": start,
                "character_end": end,
                "byte_start": _byte_offset(text, start),
                "byte_end": _byte_offset(text, end),
            }
        )

    decoded = tokenizer.decode(
        token_ids,
        skip_special_tokens=False,
        clean_up_tokenization_spaces=False,
    )
    return {
        "tokens": tokens,
        "token_ids": token_ids,
        "pieces": pieces,
        "token_count": len(token_ids),
        "decoded": decoded,
        "decoded_sha256": _sha256_text(decoded),
        "add_special_tokens": add_special_tokens,
    }


def inspect_tokenizer(root: Path) -> dict[str, Any]:
    tokenizer = _load(root)
    return {
        "available": True,
        "engine": "huggingface-tokenizers",
        "class": tokenizer.__class__.__name__,
        "fast": True,
        "vocabulary_size": int(tokenizer.vocab_size),
        "model_max_length": _context_length(tokenizer),
        "special_tokens": tokenizer.special_tokens_map,
        "chat_template": bool(getattr(tokenizer, "chat_template", None)),
        "offline": True,
        "trust_remote_code": False,
    }


def export_portable_tokenizer(root: Path, destination: Path) -> list[str]:
    """Serialize one verified fast tokenizer without executing repository code.

    Compatible SentencePiece, tiktoken, BPE, WordPiece, Unigram and WordLevel
    sources are normalized into the same portable tokenizer.json format.
    """

    tokenizer = _load(root)
    destination.mkdir(mode=0o750, parents=True, exist_ok=True)
    written = tokenizer.save_pretrained(destination, legacy_format=False)
    paths: list[str] = []
    destination_root = destination.resolve()
    for raw_path in written:
        path = Path(raw_path).resolve(strict=True)
        if not path.is_relative_to(destination_root) or not path.is_file():
            raise RuntimeError("tokenizer exporter wrote outside the pack directory")
        path.chmod(0o440)
        paths.append(path.relative_to(destination_root).as_posix())
    tokenizer_json = destination / "tokenizer.json"
    if not tokenizer_json.is_file() or tokenizer_json.is_symlink():
        raise ValueError("the tokenizer cannot be converted to a portable safe pack")
    # Verification must load the exported bytes, not the source cache entry.
    _load_cached.cache_clear()
    return sorted(paths)


def tokenize_text(root: Path, text: str, add_special_tokens: bool = True) -> dict[str, Any]:
    if len(text) > MAX_TOKENIZER_INPUT_CHARACTERS:
        raise ValueError("tokenizer input exceeds 100000 characters")
    tokenizer = _load(root)
    result = _encoded(tokenizer, text, add_special_tokens)
    result.update(
        {
            "engine": "huggingface-tokenizers",
            "tokenizer_class": tokenizer.__class__.__name__,
            "context_length": _context_length(tokenizer),
        }
    )
    return result


def decode_token_ids(
    root: Path,
    token_ids: list[int],
    *,
    skip_special_tokens: bool = False,
) -> dict[str, Any]:
    if not token_ids or len(token_ids) > MAX_DECODE_TOKEN_IDS:
        raise ValueError("decode requires between 1 and 100000 token IDs")
    if any(type(value) is not int or value < 0 or value > 2**31 - 1 for value in token_ids):
        raise ValueError("token IDs must be non-negative 32-bit integers")
    tokenizer = _load(root)
    text = tokenizer.decode(
        token_ids,
        skip_special_tokens=skip_special_tokens,
        clean_up_tokenization_spaces=False,
    )
    return {
        "text": text,
        "text_sha256": _sha256_text(text),
        "token_ids": token_ids,
        "token_count": len(token_ids),
        "skip_special_tokens": skip_special_tokens,
        "engine": "huggingface-tokenizers",
        "tokenizer_class": tokenizer.__class__.__name__,
    }


def tokenizer_verification_vectors(root: Path) -> list[dict[str, Any]]:
    tokenizer = _load(root)
    vectors: list[dict[str, Any]] = []
    for name, text in VERIFICATION_TEXTS:
        encoded = _encoded(tokenizer, text, False)
        vectors.append(
            {
                "name": name,
                "text": text,
                "add_special_tokens": False,
                "token_ids": encoded["token_ids"],
                "decoded_sha256": encoded["decoded_sha256"],
            }
        )
    return vectors
