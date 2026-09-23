from __future__ import annotations

import struct
from pathlib import Path

import pytest
from tokenizers import Tokenizer, normalizers
from tokenizers.models import WordLevel

from superii_runtime.inspectors.gguf_tokenizers import (
    _conversion_variants,
    _matches_reference,
    export_portable_gguf_tokenizer,
)
from superii_runtime.inspectors.tokenizers import decode_token_ids, tokenize_text


def _string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def _entry_string(name: str, value: str) -> bytes:
    return _string(name) + struct.pack("<I", 8) + _string(value)


def _entry_uint32(name: str, value: int) -> bytes:
    return _string(name) + struct.pack("<II", 4, value)


def _entry_string_array(name: str, values: list[str]) -> bytes:
    return (
        _string(name)
        + struct.pack("<IIQ", 9, 8, len(values))
        + b"".join(_string(value) for value in values)
    )


def _entry_int32_array(name: str, values: list[int]) -> bytes:
    return (
        _string(name)
        + struct.pack("<IIQ", 9, 5, len(values))
        + struct.pack(f"<{len(values)}i", *values)
    )


def _tiny_qwen35_gguf(path: Path) -> None:
    tokens = [
        "a",
        "b",
        "ab",
        "<|endoftext|>",
        "<|im_start|>",
        "<|im_end|>",
        "<unk>",
    ]
    metadata = [
        _entry_string("general.architecture", "qwen35"),
        _entry_string("tokenizer.ggml.model", "gpt2"),
        _entry_string_array("tokenizer.ggml.tokens", tokens),
        _entry_string_array("tokenizer.ggml.merges", ["a b"]),
        _entry_int32_array("tokenizer.ggml.token_type", [1, 1, 1, 3, 3, 3, 3]),
        _entry_uint32("tokenizer.ggml.bos_token_id", 4),
        _entry_uint32("tokenizer.ggml.eos_token_id", 5),
        _entry_uint32("tokenizer.ggml.unknown_token_id", 6),
        _entry_uint32("tokenizer.ggml.padding_token_id", 3),
    ]
    path.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, len(metadata)) + b"".join(metadata))


def test_qwen35_gguf_is_converted_to_exact_portable_tokenizer(tmp_path: Path) -> None:
    source = tmp_path / "tokenizer.gguf"
    destination = tmp_path / "pack"
    _tiny_qwen35_gguf(source)

    result = export_portable_gguf_tokenizer(
        source,
        destination,
        [
            {
                "name": "plain",
                "text": "ab",
                "add_special_tokens": False,
                "token_ids": [2],
            }
        ],
        context_length=4096,
    )
    encoded = tokenize_text(destination, "ab", False)
    decoded = decode_token_ids(destination, encoded["token_ids"], skip_special_tokens=False)

    assert result["source_architecture"] == "qwen35"
    assert result["converter_architecture"] == "qwen3"
    assert encoded["token_ids"] == [2]
    assert decoded["text"] == "ab"
    assert (destination / "tokenizer.json").is_file()
    assert (destination / "tokenizer_config.json").is_file()


def test_gguf_conversion_fails_closed_when_native_ids_do_not_match(tmp_path: Path) -> None:
    source = tmp_path / "tokenizer.gguf"
    _tiny_qwen35_gguf(source)

    with pytest.raises(ValueError, match="did not match pinned llama.cpp"):
        export_portable_gguf_tokenizer(
            source,
            tmp_path / "pack",
            [
                {
                    "name": "plain",
                    "text": "ab",
                    "add_special_tokens": False,
                    "token_ids": [1, 0],
                }
            ],
            context_length=None,
        )


def test_native_oracle_can_select_exact_non_normalizing_unicode_variant() -> None:
    tokenizer = Tokenizer(
        WordLevel(
            {
                "<unk>": 0,
                "café": 1,
                "cafe\u0301": 2,
            },
            unk_token="<unk>",  # noqa: S106 - tokenizer sentinel, not a credential
        )
    )
    tokenizer.normalizer = normalizers.NFC()
    vectors = [
        {
            "name": "unicode-nfd",
            "text": "cafe\u0301",
            "add_special_tokens": False,
            "token_ids": [2],
        }
    ]

    variants = dict(_conversion_variants(tokenizer, source_pretokenizer="gpt2"))

    assert _matches_reference(variants["converter-default"], vectors) is False
    assert _matches_reference(variants["normalizer-disabled"], vectors) is True
