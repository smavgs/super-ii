from __future__ import annotations

import os
from collections import defaultdict
from pathlib import Path
from typing import Any

DATASET_BUILDERS = {
    ".arrow": "arrow",
    ".csv": "csv",
    ".json": "json",
    ".jsonl": "json",
    ".ndjson": "json",
    ".parquet": "parquet",
    ".txt": "text",
}
MEDIA_SUFFIXES = {
    ".aac": "audio",
    ".flac": "audio",
    ".jpeg": "image",
    ".jpg": "image",
    ".m4a": "audio",
    ".mp3": "audio",
    ".mp4": "video",
    ".ogg": "audio",
    ".pdf": "pdf",
    ".png": "image",
    ".wav": "audio",
    ".webm": "video",
    ".webp": "image",
}
SPLIT_NAMES = {"train", "test", "validation", "valid", "dev"}


def _offline_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def _split_for(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    for part in relative.parts[:-1]:
        lower = part.lower()
        if lower in SPLIT_NAMES:
            return "validation" if lower in {"valid", "dev"} else lower
    lower_stem = path.stem.lower()
    for split in SPLIT_NAMES:
        if (
            lower_stem == split
            or lower_stem.startswith(f"{split}-")
            or lower_stem.startswith(f"{split}_")
        ):
            return "validation" if split in {"valid", "dev"} else split
    return "train"


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return {"media": "bytes", "size_bytes": len(value)}
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "tolist"):
        return _json_safe(value.tolist())
    return str(value)


def _inspect_tabular_group(builder: str, files: list[Path], root: Path) -> dict[str, Any]:
    from datasets import load_dataset

    grouped: dict[str, list[str]] = defaultdict(list)
    for file_path in files:
        grouped[_split_for(file_path, root)].append(str(file_path))

    loaded = load_dataset(
        builder,
        data_files=dict(grouped),
        download_mode="reuse_cache_if_exists",
    )
    splits: dict[str, Any] = {}
    for split_name, dataset in loaded.items():
        preview_count = min(100, len(dataset))
        rows = [_json_safe(dataset[index]) for index in range(preview_count)]
        splits[split_name] = {
            "row_count": len(dataset),
            "columns": list(dataset.column_names),
            "features": _json_safe(dataset.features.to_dict()),
            "preview": rows,
        }
    return {"format": builder, "splits": splits}


def inspect_dataset(root: Path) -> dict[str, Any]:
    """Inspect only local files; no dataset script or remote repository is ever loaded."""

    _offline_environment()
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError("dataset inspection requires a local directory")

    tabular: dict[str, list[Path]] = defaultdict(list)
    media: list[dict[str, Any]] = []
    ignored: list[str] = []
    for path in sorted(item for item in resolved.rglob("*") if item.is_file()):
        suffix = path.suffix.lower()
        relative = path.relative_to(resolved).as_posix()
        builder = DATASET_BUILDERS.get(suffix)
        if builder:
            tabular[builder].append(path)
        elif media_kind := MEDIA_SUFFIXES.get(suffix):
            media.append(
                {
                    "path": relative,
                    "kind": media_kind,
                    "size_bytes": path.stat().st_size,
                }
            )
        else:
            ignored.append(relative)

    groups = [
        _inspect_tabular_group(builder, files, resolved) for builder, files in tabular.items()
    ]
    total_rows = sum(split["row_count"] for group in groups for split in group["splits"].values())
    return {
        "formats": groups,
        "row_count": total_rows,
        "media": media[:100],
        "media_count": len(media),
        "ignored_files": ignored,
    }
