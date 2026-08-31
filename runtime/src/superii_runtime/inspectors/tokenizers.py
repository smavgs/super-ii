from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _offline_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


@lru_cache(maxsize=4)
def _load_cached(root_value: str):
    _offline_environment()
    from transformers import AutoTokenizer

    resolved = Path(root_value).resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("tokenizer inspection requires a local directory")
    return AutoTokenizer.from_pretrained(
        resolved,
        local_files_only=True,
        trust_remote_code=False,
        use_fast=True,
    )


def _load(root: Path):
    return _load_cached(str(root.resolve(strict=True)))


def tokenizer_cache_info() -> dict[str, int]:
    info = _load_cached.cache_info()
    return {"hits": info.hits, "misses": info.misses, "size": info.currsize, "max_size": 4}


def inspect_tokenizer(root: Path) -> dict[str, Any]:
    tokenizer = _load(root)
    return {
        "class": tokenizer.__class__.__name__,
        "fast": bool(tokenizer.is_fast),
        "vocabulary_size": int(tokenizer.vocab_size),
        "model_max_length": int(tokenizer.model_max_length),
        "special_tokens": tokenizer.special_tokens_map,
        "offline": True,
    }


def tokenize_text(root: Path, text: str, add_special_tokens: bool = True) -> dict[str, Any]:
    if len(text) > 100_000:
        raise ValueError("tokenizer input exceeds 100000 characters")
    tokenizer = _load(root)
    token_ids = tokenizer.encode(text, add_special_tokens=add_special_tokens)
    tokens = tokenizer.convert_ids_to_tokens(token_ids)
    return {
        "tokens": tokens,
        "token_ids": token_ids,
        "token_count": len(token_ids),
        "add_special_tokens": add_special_tokens,
    }
