from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from superii_runtime.artifacts import ArtifactStore


class FakeImage:
    def save(self, target: Path, *, format: str) -> None:
        assert format == "PNG"
        target.write_bytes(b"png")


def test_generated_artifacts_are_atomic_private_and_expire(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path, retention_seconds=300)
    artifact_id = store.save_png(FakeImage())
    path = store.resolve_png(artifact_id)

    assert path.read_bytes() == b"png"
    assert path.stat().st_mode & 0o777 == 0o600
    assert not list(store.root.glob(".*.tmp"))

    expired = time.time() - 301
    os.utime(path, (expired, expired))
    with pytest.raises(FileNotFoundError):
        store.resolve_png(artifact_id)
    assert not path.exists()
