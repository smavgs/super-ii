from __future__ import annotations

import os
from pathlib import Path
from typing import Any

CONTEXT_KEYS = (
    "max_position_embeddings",
    "n_positions",
    "max_sequence_length",
    "seq_length",
    "model_max_length",
)


def _offline_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


def _tasks(architectures: list[str]) -> list[str]:
    inferred: set[str] = set()
    for architecture in architectures:
        lower = architecture.lower()
        if "causallm" in lower:
            inferred.add("text-generation")
        if "maskedlm" in lower:
            inferred.add("fill-mask")
        if "sequenceclassification" in lower:
            inferred.add("text-classification")
        if "tokenclassification" in lower:
            inferred.add("token-classification")
        if "questionanswering" in lower:
            inferred.add("question-answering")
        if "imageclassification" in lower:
            inferred.add("image-classification")
        if "audio" in lower or "speech" in lower:
            inferred.add("audio")
        if "vision2seq" in lower or "conditionalgeneration" in lower:
            inferred.add("multimodal-generation")
    return sorted(inferred)


def inspect_model(root: Path) -> dict[str, Any]:
    """Read local model configuration without loading weights or executing repository code."""

    _offline_environment()
    from transformers import AutoConfig, GenerationConfig

    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("model inspection requires a local directory")

    config = AutoConfig.from_pretrained(
        resolved,
        local_files_only=True,
        trust_remote_code=False,
    )
    raw_config = config.to_dict()
    architectures = [str(value) for value in raw_config.get("architectures") or []]
    context_length = next(
        (raw_config[key] for key in CONTEXT_KEYS if isinstance(raw_config.get(key), int)),
        None,
    )
    generation: dict[str, Any] | None = None
    try:
        generation = GenerationConfig.from_pretrained(
            resolved,
            local_files_only=True,
        ).to_dict()
    except (OSError, ValueError):
        generation_file = resolved / "generation_config.json"
        if generation_file.exists():
            raise

    weight_formats = sorted({path.suffix.lower() for path in resolved.rglob("*") if path.is_file()})
    return {
        "model_type": raw_config.get("model_type"),
        "architectures": architectures,
        "tasks": _tasks(architectures),
        "context_length": context_length,
        "vocabulary_size": raw_config.get("vocab_size"),
        "generation": generation,
        "config": raw_config,
        "file_extensions": weight_formats,
        "offline": True,
        "trust_remote_code": False,
    }
