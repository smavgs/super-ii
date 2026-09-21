from __future__ import annotations

import json
import stat
from pathlib import Path, PurePosixPath

from .client import Snapshot
from .errors import IntegrityError
from .manifest import safe_path

MAX_INDEX_BYTES = 4 * 1024**2


def _selected_regular_file(
    snapshot: Snapshot, selected: frozenset[str], name: str, description: str
) -> Path:
    try:
        canonical = safe_path(name)
    except IntegrityError as error:
        raise IntegrityError(f"{description} uses an unsafe path") from error
    if canonical not in selected:
        raise IntegrityError(f"{description} is outside the verified snapshot")

    root = snapshot.path.resolve()
    location = snapshot.path.joinpath(*PurePosixPath(canonical).parts)
    try:
        metadata = location.lstat()
    except OSError as error:
        raise IntegrityError(f"{description} is unavailable") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise IntegrityError(f"{description} must be a regular file")
    try:
        if not location.resolve(strict=True).is_relative_to(root):
            raise IntegrityError(f"{description} escapes the verified snapshot")
    except OSError as error:
        raise IntegrityError(f"{description} cannot be resolved safely") from error
    return location


def validate_safetensor_indexes(snapshot: Snapshot) -> None:
    """Reject shard indexes that could make a loader open unverified paths."""

    selected = frozenset(snapshot.files)
    selected_indexes = {name for name in selected if name.endswith(".safetensors.index.json")}
    try:
        disk_indexes = {
            item.name
            for item in snapshot.path.iterdir()
            if item.name.endswith(".safetensors.index.json")
        }
    except OSError as error:
        raise IntegrityError("Verified snapshot cannot be inspected safely") from error

    for name in sorted(selected_indexes | disk_indexes):
        index = _selected_regular_file(snapshot, selected, name, "Weight index")
        if index.lstat().st_size > MAX_INDEX_BYTES:
            raise IntegrityError("Weight index exceeds 4 MiB")
        try:
            document = json.loads(index.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise IntegrityError("Weight index is not valid bounded JSON") from error
        if not isinstance(document, dict) or not isinstance(document.get("weight_map"), dict):
            raise IntegrityError("Weight index requires an object weight_map")
        for value in document["weight_map"].values():
            if not isinstance(value, str) or not value.endswith(".safetensors"):
                raise IntegrityError("Weight index must reference Safetensors shards")
            _selected_regular_file(snapshot, selected, value, "Weight shard")
