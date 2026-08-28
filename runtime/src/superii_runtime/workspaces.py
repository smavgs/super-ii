from __future__ import annotations

import hashlib
import os
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from .database import RepositoryDatabase, RevisionFile
from .storage import ObjectStore, normalize_repository_path


def revision_manifest(files: list[RevisionFile]) -> str:
    digest = hashlib.sha256()
    for file in sorted(files, key=lambda item: item.path):
        line = f"{file.path}\0{file.sha256}\0{file.size_bytes}\n".encode()
        digest.update(line)
    return digest.hexdigest()


@contextmanager
def materialized_revision(
    database: RepositoryDatabase,
    store: ObjectStore,
    revision_id: UUID,
) -> Iterator[Path]:
    """Create a verified, read-only checkout of one immutable revision."""

    files = database.list_revision_files(revision_id)
    if not files:
        raise ValueError("revision has no clean files")
    workspace = store.workspace_root / str(uuid4())
    workspace.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        for file in files:
            relative = Path(*normalize_repository_path(file.path).split("/"))
            source = store.resolve_key(file.storage_key)
            if not source.is_file() or store.sha256(source) != file.sha256:
                raise ValueError(f"stored object failed verification: {file.path}")
            target = workspace / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            try:
                os.link(source, target, follow_symlinks=False)
            except OSError:
                shutil.copyfile(source, target, follow_symlinks=False)
            os.chmod(target, 0o440)
        yield workspace
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
