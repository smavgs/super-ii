from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

from safetensors import safe_open

MAX_HEADER_BYTES = 100 * 1024 * 1024


def _read_header(path: Path) -> dict[str, Any]:
    with path.open("rb") as source:
        encoded_size = source.read(8)
        if len(encoded_size) != 8:
            raise ValueError("safetensors file is missing its header length")
        header_size = struct.unpack("<Q", encoded_size)[0]
        if header_size <= 0 or header_size > MAX_HEADER_BYTES:
            raise ValueError("safetensors header size is invalid")
        header = source.read(header_size)
        if len(header) != header_size:
            raise ValueError("safetensors header is truncated")
    parsed = json.loads(header.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("safetensors header must be an object")
    return parsed


def inspect_safetensors(path: Path) -> dict[str, Any]:
    """Validate with safetensors and return metadata without loading tensor values."""

    resolved = path.resolve(strict=True)
    if resolved.suffix.lower() != ".safetensors":
        raise ValueError("expected a .safetensors file")

    header = _read_header(resolved)
    with safe_open(resolved, framework="numpy", device="cpu") as handle:
        keys = list(handle.keys())
        metadata = handle.metadata() or {}

    tensors: list[dict[str, Any]] = []
    for name in keys:
        entry = header.get(name)
        if not isinstance(entry, dict):
            raise ValueError(f"tensor {name!r} is missing its header entry")
        shape = entry.get("shape")
        dtype = entry.get("dtype")
        offsets = entry.get("data_offsets")
        if not isinstance(shape, list) or not isinstance(dtype, str):
            raise ValueError(f"tensor {name!r} has an invalid header")
        tensors.append(
            {
                "name": name,
                "shape": shape,
                "dtype": dtype,
                "data_offsets": offsets,
            }
        )

    return {
        "format": "safetensors",
        "valid": True,
        "file_size_bytes": resolved.stat().st_size,
        "tensor_count": len(tensors),
        "tensors": tensors,
        "metadata": metadata,
    }
