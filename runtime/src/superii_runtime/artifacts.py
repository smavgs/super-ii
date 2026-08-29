from __future__ import annotations

import os
import time
from pathlib import Path
from uuid import UUID, uuid4


class ArtifactStore:
    def __init__(self, root: Path, retention_seconds: int = 86_400) -> None:
        self.root = (root / "generated").resolve()
        self.retention_seconds = retention_seconds
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    def save_png(self, image: object) -> UUID:
        self.prune()
        artifact_id = uuid4()
        target = self.root / f"{artifact_id}.png"
        temporary = self.root / f".{artifact_id}.tmp"
        try:
            image.save(temporary, format="PNG")  # type: ignore[attr-defined]
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return artifact_id

    def resolve_png(self, artifact_id: UUID) -> Path:
        self.prune()
        path = (self.root / f"{artifact_id}.png").resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise FileNotFoundError(str(artifact_id))
        return path

    def prune(self) -> int:
        cutoff = time.time() - self.retention_seconds
        removed = 0
        for path in self.root.glob("*.png"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed += 1
            except FileNotFoundError:
                continue
        return removed
