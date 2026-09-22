from __future__ import annotations

import hashlib
import math
import re
from array import array
from pathlib import Path
from typing import Any

MAX_GGUF_VOCABULARY = 1_000_000
MAX_CHAT_TEMPLATE_CHARACTERS = 1_000_000

# llama.cpp sometimes introduces an architecture identifier before the pinned
# Transformers GGUF converter learns that name. These aliases are deliberately
# narrow: the generated tokenizer still has to match llama.cpp's exact token
# IDs for every verification vector before it can be published.
ARCHITECTURE_ALIASES = {
    "gemma3": "gemma3_text",
    "gemma4": "gemma4_text",
    "minimax-m2": "minimax_m2",
    "qwen2moe": "qwen2_moe",
    "qwen3moe": "qwen3_moe",
    "qwen35": "qwen3",
}


def _type_number(value: Any) -> int:
    raw = getattr(value, "value", value)
    if type(raw) is not int:
        raise ValueError("GGUF tokenizer metadata type is invalid")
    return raw


def _parse_value(value: Any, data_types: list[Any]) -> Any:
    types = [_type_number(item) for item in data_types]
    if not types:
        raise ValueError("GGUF tokenizer metadata has no type")
    data_type = types[0]
    nested_type = types[1:] if len(types) > 1 else []
    if data_type in {0, 1, 2, 3, 4, 5, 10, 11}:
        return int(value[0])
    if data_type in {6, 12}:
        return float(value[0])
    if data_type == 7:
        return bool(value[0])
    if data_type == 8:
        return array("B", list(value)).tobytes().decode("utf-8")
    if data_type == 9 and len(nested_type) == 1:
        return _parse_value(value, nested_type)
    raise ValueError("GGUF tokenizer metadata type is unsupported")


def _field_value(field: Any) -> Any:
    values = [_parse_value(field.parts[index], list(field.types)) for index in field.data]
    if not values:
        raise ValueError("GGUF tokenizer metadata field is empty")
    if _type_number(field.types[0]) == 9:
        return values
    return values[0] if len(values) == 1 else values


def _tokenizer_dictionary(reader: Any, mapping: dict[str, dict[str, str]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for source_name, target_name in mapping["tokenizer"].items():
        field = reader.fields.get(f"tokenizer.{source_name}")
        if field is not None:
            result[target_name] = _field_value(field)

    tokens = result.get("tokens")
    if (
        not isinstance(tokens, list)
        or not 0 < len(tokens) <= MAX_GGUF_VOCABULARY
        or not all(isinstance(token, str) for token in tokens)
    ):
        raise ValueError("GGUF tokenizer vocabulary is invalid")
    for name in ("merges", "scores", "token_type"):
        values = result.get(name)
        if values is not None and (
            not isinstance(values, list) or len(values) > MAX_GGUF_VOCABULARY
        ):
            raise ValueError(f"GGUF tokenizer {name} metadata is invalid")
    merges = result.get("merges")
    if merges is not None and not all(isinstance(value, str) for value in merges):
        raise ValueError("GGUF tokenizer merges metadata is invalid")
    scores = result.get("scores")
    if scores is not None and not all(
        type(value) in {int, float} and math.isfinite(value) for value in scores
    ):
        raise ValueError("GGUF tokenizer scores metadata is invalid")
    token_types = result.get("token_type")
    if token_types is not None and not all(
        type(value) is int and 0 <= value <= 10 for value in token_types
    ):
        raise ValueError("GGUF tokenizer token_type metadata is invalid")
    for name in ("scores", "token_type"):
        values = result.get(name)
        if values is not None and len(values) != len(tokens):
            raise ValueError(f"GGUF tokenizer {name} metadata is incomplete")
    for name in ("bos_token_id", "eos_token_id", "unk_token_id", "pad_token_id"):
        token_id = result.get(name)
        if token_id is not None and (
            type(token_id) is not int or token_id < 0 or token_id >= len(tokens)
        ):
            raise ValueError(f"GGUF tokenizer {name} is invalid")
    return result


def _converter_candidates(
    architecture: str,
    tokenizer_type: str,
    supported: set[str],
) -> list[str]:
    candidates: list[str] = []

    def add(value: str | None) -> None:
        if value and value in supported and value not in candidates:
            candidates.append(value)

    normalized = ARCHITECTURE_ALIASES.get(architecture, architecture)
    add(normalized)
    if "qwen" in architecture:
        add("qwen3")
        add("qwen2")
    if "llama" in architecture or "mistral" in architecture:
        add("llama")
    if tokenizer_type == "llama":
        add("llama")
    elif tokenizer_type == "gpt2":
        # GPT-2 metadata is shared by native GPT models, Qwen-family models and
        # Llama 3. Exact oracle matching below chooses the only safe result.
        add("gpt2")
        add("qwen3")
        add("llama")
    elif tokenizer_type in {"t5", "spm", "sentencepiece"}:
        add("t5")
        add("llama")
    return candidates


def _matches_reference(tokenizer: Any, vectors: list[dict[str, Any]]) -> bool:
    for vector in vectors:
        text = vector.get("text")
        reference_ids = vector.get("token_ids")
        add_special_tokens = vector.get("add_special_tokens")
        if (
            not isinstance(text, str)
            or not isinstance(reference_ids, list)
            or type(add_special_tokens) is not bool
        ):
            raise ValueError("GGUF tokenizer verification vector is invalid")
        encoded = tokenizer.encode(text, add_special_tokens=add_special_tokens)
        if encoded.ids != reference_ids:
            return False
        decoded = tokenizer.decode(
            encoded.ids,
            skip_special_tokens=add_special_tokens,
        )
        if (
            hashlib.sha256(decoded.encode("utf-8")).hexdigest()
            != hashlib.sha256(text.encode("utf-8")).hexdigest()
        ):
            return False
    return True


def export_portable_gguf_tokenizer(
    source: Path,
    destination: Path,
    reference_vectors: list[dict[str, Any]],
    *,
    context_length: int | None,
) -> dict[str, Any]:
    """Convert GGUF tokenizer metadata into a portable, code-free tokenizer pack.

    Conversion alone is never trusted. The generated tokenizer must reproduce
    token IDs emitted by the pinned llama.cpp tokenizer for the immutable GGUF
    source and must round-trip every plain, multilingual and emoji vector.
    """

    from gguf import GGUFReader
    from transformers import PreTrainedTokenizerFast
    from transformers.integrations.ggml import (
        GGUF_TO_FAST_CONVERTERS,
        GGUF_TOKENIZER_MAPPING,
        convert_gguf_tokenizer,
    )

    resolved = source.resolve(strict=True)
    if resolved.suffix.lower() != ".gguf" or not resolved.is_file() or resolved.is_symlink():
        raise ValueError("GGUF tokenizer conversion requires a local regular file")
    reader = GGUFReader(resolved, "r")
    architecture_field = reader.fields.get("general.architecture")
    if architecture_field is None:
        raise ValueError("GGUF tokenizer architecture is missing")
    architecture = _field_value(architecture_field)
    if not isinstance(architecture, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", architecture):
        raise ValueError("GGUF tokenizer architecture is invalid")

    tokenizer_dictionary = _tokenizer_dictionary(reader, GGUF_TOKENIZER_MAPPING)
    tokenizer_type = tokenizer_dictionary.get("tokenizer_type")
    if not isinstance(tokenizer_type, str) or len(tokenizer_type) > 64:
        raise ValueError("GGUF tokenizer type is invalid")
    candidates = _converter_candidates(
        architecture,
        tokenizer_type,
        set(GGUF_TO_FAST_CONVERTERS),
    )
    if not candidates:
        raise ValueError("GGUF tokenizer has no supported safe converter")

    converted = None
    additional_kwargs: dict[str, Any] = {}
    selected_architecture = ""
    for candidate in candidates:
        try:
            candidate_tokenizer, candidate_kwargs = convert_gguf_tokenizer(
                candidate,
                tokenizer_dictionary,
            )
            matches_reference = _matches_reference(candidate_tokenizer, reference_vectors)
        except (IndexError, KeyError, RuntimeError, TypeError, ValueError):
            continue
        if matches_reference:
            converted = candidate_tokenizer
            additional_kwargs = dict(candidate_kwargs)
            selected_architecture = candidate
            break
    if converted is None:
        raise ValueError("GGUF tokenizer conversion did not match pinned llama.cpp")

    tokens = tokenizer_dictionary["tokens"]
    for role in ("bos", "eos", "unk", "pad"):
        token_id = tokenizer_dictionary.get(f"{role}_token_id")
        if type(token_id) is int:
            additional_kwargs[f"{role}_token"] = tokens[token_id]
    if context_length is not None:
        additional_kwargs["model_max_length"] = context_length
    chat_template_field = reader.fields.get("tokenizer.chat_template")
    if chat_template_field is not None:
        chat_template = _field_value(chat_template_field)
        if not isinstance(chat_template, str) or len(chat_template) > MAX_CHAT_TEMPLATE_CHARACTERS:
            raise ValueError("GGUF tokenizer chat template is invalid")
        additional_kwargs["chat_template"] = chat_template

    destination.mkdir(mode=0o750, parents=True, exist_ok=True)
    portable = PreTrainedTokenizerFast(
        tokenizer_object=converted,
        **additional_kwargs,
    )
    written = portable.save_pretrained(destination, legacy_format=False)
    destination_root = destination.resolve()
    paths: list[str] = []
    for raw_path in written:
        path = Path(raw_path).resolve(strict=True)
        if not path.is_relative_to(destination_root) or not path.is_file() or path.is_symlink():
            raise RuntimeError("GGUF tokenizer exporter wrote outside the pack directory")
        path.chmod(0o440)
        paths.append(path.relative_to(destination_root).as_posix())
    tokenizer_json = destination / "tokenizer.json"
    if not tokenizer_json.is_file() or tokenizer_json.is_symlink():
        raise RuntimeError("GGUF tokenizer exporter did not create tokenizer.json")
    return {
        "source_architecture": architecture,
        "source_tokenizer_type": tokenizer_type,
        "converter_architecture": selected_architecture,
        "written": sorted(paths),
    }
