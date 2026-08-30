from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Protocol

GIB = 1024**3
MIB = 1024**2
MAX_DECLARATION_BYTES = 64 * 1024
QUANTIZATION_PATTERN = re.compile(
    r"(?:^|[._-])((?:IQ|Q)[2-8](?:_[A-Z0-9]+)*|BF16|F16|F32)(?:[._-]|$)",
    re.IGNORECASE,
)
BOOLEAN_FIELDS = (
    "cpu_compatible",
    "cuda_compatible",
    "rocm_compatible",
    "metal_compatible",
    "mlx_compatible",
    "llama_cpp_compatible",
    "browser_compatible",
)
INTEGER_FIELDS = (
    "parameter_count",
    "model_size_bytes",
    "minimum_ram_bytes",
    "minimum_vram_bytes",
)


class SizedRepositoryFile(Protocol):
    path: str
    size_bytes: int


def _round_memory(value: int) -> int:
    return int(math.ceil(max(value, 0) / (256 * MIB)) * 256 * MIB)


def _shape_size(shape: object) -> int:
    if not isinstance(shape, list) or not shape:
        return 0
    size = 1
    for dimension in shape:
        if not isinstance(dimension, int) or dimension < 0:
            return 0
        size *= dimension
    return size


def _parameter_count(analysis: dict[str, Any]) -> int | None:
    total = 0
    seen = False
    for entry in analysis.get("safetensors") or []:
        if not isinstance(entry, dict):
            continue
        inspection = entry.get("inspection")
        if not isinstance(inspection, dict):
            continue
        for tensor in inspection.get("tensors") or []:
            if not isinstance(tensor, dict):
                continue
            count = _shape_size(tensor.get("shape"))
            if count:
                total += count
                seen = True
    for entry in analysis.get("gguf") or []:
        if not isinstance(entry, dict):
            continue
        inspection = entry.get("inspection")
        if not isinstance(inspection, dict):
            continue
        metadata = inspection.get("metadata")
        if not isinstance(metadata, dict):
            continue
        declared = metadata.get("general.parameter_count")
        if isinstance(declared, int) and declared > 0:
            return declared
    return total if seen else None


def _quantization(analysis: dict[str, Any], paths: Iterable[str]) -> str | None:
    for path in paths:
        match = QUANTIZATION_PATTERN.search(path)
        if match:
            return match.group(1).upper()
    for entry in analysis.get("gguf") or []:
        if not isinstance(entry, dict):
            continue
        inspection = entry.get("inspection")
        metadata = inspection.get("metadata") if isinstance(inspection, dict) else None
        file_type = metadata.get("general.file_type") if isinstance(metadata, dict) else None
        if isinstance(file_type, (int, str)):
            return f"GGUF-{file_type}"
    return None


def _declaration(root: Path) -> dict[str, Any] | None:
    path = root / "superii-compatibility.json"
    if not path.is_file():
        return None
    if path.stat().st_size > MAX_DECLARATION_BYTES:
        raise ValueError("superii-compatibility.json exceeds 64 KiB")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("superii-compatibility.json is invalid JSON") from error
    if not isinstance(value, dict):
        raise ValueError("superii-compatibility.json must contain an object")

    declaration: dict[str, Any] = {}
    for field in BOOLEAN_FIELDS:
        candidate = value.get(field)
        if candidate is not None and not isinstance(candidate, bool):
            raise ValueError(f"{field} must be a boolean")
        if isinstance(candidate, bool):
            declaration[field] = candidate
    for field in INTEGER_FIELDS:
        candidate = value.get(field)
        if candidate is not None and (not isinstance(candidate, int) or candidate < 0):
            raise ValueError(f"{field} must be a non-negative integer")
        if isinstance(candidate, int):
            declaration[field] = candidate
    for field in ("architecture", "quantization", "tensor_format"):
        candidate = value.get(field)
        if candidate is not None and (not isinstance(candidate, str) or len(candidate) > 200):
            raise ValueError(f"{field} must be a short string")
        if isinstance(candidate, str) and candidate.strip():
            declaration[field] = candidate.strip()
    evidence = value.get("evidence_urls")
    if evidence is not None:
        if not isinstance(evidence, list) or len(evidence) > 20:
            raise ValueError("evidence_urls must be a list of at most 20 HTTPS URLs")
        normalized = []
        for candidate in evidence:
            if (
                not isinstance(candidate, str)
                or not candidate.startswith("https://")
                or len(candidate) > 2048
            ):
                raise ValueError("evidence_urls must contain only HTTPS URLs")
            normalized.append(candidate)
        declaration["evidence_urls"] = normalized
    return declaration


def derive_model_compatibility(
    root: Path,
    analysis: dict[str, Any],
    files: Iterable[SizedRepositoryFile],
) -> dict[str, Any]:
    """Derive conservative hardware guidance without loading model weights."""

    file_list = list(files)
    paths = [file.path for file in file_list]
    suffixes = {Path(path).suffix.lower() for path in paths}
    model_size = sum(
        file.size_bytes
        for file in file_list
        if Path(file.path).suffix.lower()
        in {".gguf", ".safetensors", ".bin", ".pt", ".pth", ".onnx", ".npz"}
    )
    if model_size == 0:
        model_size = sum(file.size_bytes for file in file_list)

    has_gguf = bool(analysis.get("gguf"))
    has_safetensors = bool(analysis.get("safetensors"))
    has_diffusers = isinstance(analysis.get("diffusers"), dict)
    has_model_config = isinstance(analysis.get("model"), dict)
    has_onnx = ".onnx" in suffixes
    has_mlx_package = ".npz" in suffixes or any("mlx" in path.lower() for path in paths)
    architecture = None
    model = analysis.get("model")
    if isinstance(model, dict):
        architectures = model.get("architectures")
        if isinstance(architectures, list) and architectures:
            architecture = str(architectures[0])[:200]
        elif isinstance(model.get("model_type"), str):
            architecture = str(model["model_type"])[:200]

    tensor_format = (
        "gguf"
        if has_gguf and not has_safetensors
        else "safetensors"
        if has_safetensors and not has_gguf
        else "mixed"
        if has_gguf and has_safetensors
        else "onnx"
        if has_onnx
        else None
    )
    overhead = max(GIB, int(model_size * (0.25 if has_gguf else 0.5)))
    minimum_ram = _round_memory(model_size + overhead)
    discrete_gpu = has_safetensors or has_diffusers
    minimum_vram = (
        _round_memory(model_size + max(512 * MIB, int(model_size * 0.15))) if discrete_gpu else 0
    )

    result: dict[str, Any] = {
        "architecture": architecture,
        "parameter_count": _parameter_count(analysis),
        "quantization": _quantization(analysis, paths),
        "tensor_format": tensor_format,
        "model_size_bytes": model_size,
        "minimum_ram_bytes": minimum_ram,
        "minimum_vram_bytes": minimum_vram,
        "cpu_compatible": has_gguf or has_model_config or has_onnx,
        "cuda_compatible": discrete_gpu,
        "rocm_compatible": discrete_gpu,
        "metal_compatible": has_gguf or has_safetensors or has_diffusers,
        "mlx_compatible": True if has_mlx_package else None,
        "llama_cpp_compatible": has_gguf,
        "browser_compatible": has_onnx,
        "confidence": "derived",
        "method": "superii-offline-compatibility-v1",
        "notes": [
            "Memory values are conservative format-based estimates, not benchmark guarantees.",
            "Driver, operating-system, model-code, and accelerator support can still vary.",
        ],
        "evidence_urls": [],
    }

    declared = _declaration(root)
    if declared:
        result.update(declared)
        result["confidence"] = "declared"
        result["method"] = "publisher-declaration-plus-offline-inspection-v1"
    return result
