from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID, uuid4


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = (root / "generated").resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    def save_png(self, image: object) -> UUID:
        artifact_id = uuid4()
        target = self.root / f"{artifact_id}.png"
        image.save(target, format="PNG")  # type: ignore[attr-defined]
        os.chmod(target, 0o600)
        return artifact_id

    def resolve_png(self, artifact_id: UUID) -> Path:
        path = (self.root / f"{artifact_id}.png").resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise FileNotFoundError(str(artifact_id))
        return path
