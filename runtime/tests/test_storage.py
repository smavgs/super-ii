from __future__ import annotations

import io
from pathlib import Path

import pytest

from superii_runtime.storage import ObjectStore, StorageError, normalize_repository_path


@pytest.mark.parametrize(
    "path",
    [
        "../secret",
        "/absolute",
        "model/../secret",
        "model//config.json",
        "model/./config.json",
        "a\\b",
    ],
)
def test_repository_path_rejects_aliases(path: str) -> None:
    with pytest.raises(StorageError):
        normalize_repository_path(path)


def test_content_addressed_promotion_is_deduplicated(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path, max_upload_bytes=1024)
    first = store.stage(
        io.BytesIO(b"verified"), "weights/model.safetensors", "application/octet-stream"
    )
    second = store.stage(
        io.BytesIO(b"verified"), "copy/model.safetensors", "application/octet-stream"
    )

    first_stored = store.promote(first)
    second_stored = store.promote(second)

    assert first_stored.storage_key == second_stored.storage_key
    assert first_stored.absolute_path.read_bytes() == b"verified"
    assert first_stored.absolute_path.stat().st_mode & 0o777 == 0o440


def test_upload_size_limit_removes_quarantine(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path, max_upload_bytes=3)
    with pytest.raises(StorageError, match="size limit"):
        store.stage(io.BytesIO(b"four"), "file.txt", "text/plain")
    assert not list(store.quarantine_root.iterdir())
