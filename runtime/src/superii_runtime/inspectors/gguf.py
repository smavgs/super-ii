from __future__ import annotations

import struct
from pathlib import Path
from typing import Any, BinaryIO

GGUF_TYPES: dict[int, tuple[str, str | None]] = {
    0: ("uint8", "<B"),
    1: ("int8", "<b"),
    2: ("uint16", "<H"),
    3: ("int16", "<h"),
    4: ("uint32", "<I"),
    5: ("int32", "<i"),
    6: ("float32", "<f"),
    7: ("bool", "<?"),
    8: ("string", None),
    9: ("array", None),
    10: ("uint64", "<Q"),
    11: ("int64", "<q"),
    12: ("float64", "<d"),
}
MAX_STRING_BYTES = 16 * 1024 * 1024
MAX_METADATA_ITEMS = 1_000_000
MAX_ARRAY_PREVIEW = 100
MAX_TENSOR_PREVIEW = 10_000


def _unpack(stream: BinaryIO, format_string: str) -> Any:
    size = struct.calcsize(format_string)
    encoded = stream.read(size)
    if len(encoded) != size:
        raise ValueError("GGUF file is truncated")
    return struct.unpack(format_string, encoded)[0]


def _string(stream: BinaryIO) -> str:
    size = _unpack(stream, "<Q")
    if size > MAX_STRING_BYTES:
        raise ValueError("GGUF string exceeds safety limit")
    encoded = stream.read(size)
    if len(encoded) != size:
        raise ValueError("GGUF string is truncated")
    return encoded.decode("utf-8")


def _value(stream: BinaryIO, value_type: int, *, collect: bool = True, depth: int = 0) -> Any:
    if depth > 4 or value_type not in GGUF_TYPES:
        raise ValueError("GGUF metadata type is unsupported")
    type_name, format_string = GGUF_TYPES[value_type]
    if format_string:
        value = _unpack(stream, format_string)
        return value if collect else None
    if type_name == "string":
        value = _string(stream)
        return value if collect else None
    if type_name == "array":
        nested_type = _unpack(stream, "<I")
        count = _unpack(stream, "<Q")
        if count > MAX_METADATA_ITEMS:
            raise ValueError("GGUF metadata array exceeds safety limit")
        values = []
        for index in range(count):
            nested = _value(
                stream,
                nested_type,
                collect=collect and index < MAX_ARRAY_PREVIEW,
                depth=depth + 1,
            )
            if collect and index < MAX_ARRAY_PREVIEW:
                values.append(nested)
        if not collect:
            return None
        return {
            "values": values,
            "count": count,
            "truncated": count > MAX_ARRAY_PREVIEW,
        }
    raise ValueError("GGUF metadata value could not be decoded")


def inspect_gguf(path: Path) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    if resolved.suffix.lower() != ".gguf":
        raise ValueError("expected a .gguf file")
    file_size = resolved.stat().st_size
    with resolved.open("rb") as source:
        if source.read(4) != b"GGUF":
            raise ValueError("GGUF magic bytes are invalid")
        version = _unpack(source, "<I")
        if version not in {2, 3}:
            raise ValueError(f"unsupported GGUF version: {version}")
        tensor_count = _unpack(source, "<Q")
        metadata_count = _unpack(source, "<Q")
        if metadata_count > MAX_METADATA_ITEMS:
            raise ValueError("GGUF metadata count exceeds safety limit")

        metadata: dict[str, Any] = {}
        for _ in range(metadata_count):
            key = _string(source)
            value_type = _unpack(source, "<I")
            metadata[key] = _value(source, value_type)

        tensors: list[dict[str, Any]] = []
        for index in range(tensor_count):
            name = _string(source)
            dimensions_count = _unpack(source, "<I")
            if dimensions_count > 16:
                raise ValueError("GGUF tensor has too many dimensions")
            dimensions = [_unpack(source, "<Q") for _ in range(dimensions_count)]
            tensor_type = _unpack(source, "<I")
            offset = _unpack(source, "<Q")
            if index < MAX_TENSOR_PREVIEW:
                tensors.append(
                    {
                        "name": name,
                        "shape": dimensions,
                        "ggml_type": tensor_type,
                        "offset": offset,
                    }
                )

    return {
        "format": "gguf",
        "valid": True,
        "version": version,
        "file_size_bytes": file_size,
        "tensor_count": tensor_count,
        "metadata_count": metadata_count,
        "metadata": metadata,
        "tensors": tensors,
        "tensors_truncated": tensor_count > MAX_TENSOR_PREVIEW,
    }
