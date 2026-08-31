from io import BytesIO
from pathlib import Path
from uuid import UUID

from superii_runtime.database import RevisionFile
from superii_runtime.storage import ObjectStore
from superii_runtime.workspace_cache import PersistentWorkspaceCache


class FakeDatabase:
    def __init__(self, files: list[RevisionFile]) -> None:
        self.files = files

    def list_revision_files(self, _revision_id: UUID) -> list[RevisionFile]:
        return self.files


def test_persistent_workspace_verifies_once_and_reuses_manifest(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / "data", max_upload_bytes=1024)
    staged = store.stage(BytesIO(b"verified bytes"), "models/test.gguf", "application/octet-stream")
    stored = store.promote(staged)
    revision_id = UUID("11111111-1111-4111-8111-111111111111")
    file = RevisionFile(
        id=UUID("22222222-2222-4222-8222-222222222222"),
        repository_id=UUID("33333333-3333-4333-8333-333333333333"),
        revision_id=revision_id,
        path="models/test.gguf",
        size_bytes=len(b"verified bytes"),
        mime_type="application/octet-stream",
        sha256=stored.sha256,
        storage_key=stored.storage_key,
    )
    cache = PersistentWorkspaceCache(store)
    database = FakeDatabase([file])

    first = cache.materialize(database, revision_id)  # type: ignore[arg-type]
    second = cache.materialize(database, revision_id)  # type: ignore[arg-type]

    assert first == second
    assert (first / "models/test.gguf").read_bytes() == b"verified bytes"
    assert (first / ".superii-workspace.json").is_file()
    assert (first / "models/test.gguf").stat().st_mode & 0o222 == 0
