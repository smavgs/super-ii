from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import HTTPException

from superii_runtime.api import INLINE_MEDIA_TYPES, _require_public_revision
from superii_runtime.database import RevisionFile

REPOSITORY_ID = UUID("11111111-1111-4111-8111-111111111111")
REVISION_ID = UUID("22222222-2222-4222-8222-222222222222")


def revision_file(repository_id: UUID = REPOSITORY_ID) -> RevisionFile:
    return RevisionFile(
        id=UUID("33333333-3333-4333-8333-333333333333"),
        repository_id=repository_id,
        revision_id=REVISION_ID,
        path="model.gguf",
        size_bytes=24,
        mime_type="application/octet-stream",
        sha256="0" * 64,
        storage_key="objects/sha256/00/" + "0" * 64,
    )


class FakeDatabase:
    def __init__(self, public: bool, files: list[RevisionFile]) -> None:
        self.public = public
        self.files = files

    def revision_is_public(self, repository_id: UUID, revision_id: UUID) -> bool:
        assert repository_id == REPOSITORY_ID
        assert revision_id == REVISION_ID
        return self.public

    def list_revision_files(self, revision_id: UUID) -> list[RevisionFile]:
        assert revision_id == REVISION_ID
        return self.files


@pytest.mark.parametrize(
    ("database", "reason"),
    [
        (FakeDatabase(False, [revision_file()]), "not public"),
        (FakeDatabase(True, []), "empty revision"),
        (
            FakeDatabase(
                True,
                [revision_file(UUID("44444444-4444-4444-8444-444444444444"))],
            ),
            "repository mismatch",
        ),
    ],
)
def test_local_tools_reject_unpublished_or_mismatched_revisions(
    database: FakeDatabase,
    reason: str,
) -> None:
    with pytest.raises(HTTPException, match="published revision not found") as raised:
        _require_public_revision(database, REPOSITORY_ID, REVISION_ID)  # type: ignore[arg-type]
    assert raised.value.status_code == 404, reason


def test_local_tools_accept_exact_public_revision() -> None:
    _require_public_revision(  # type: ignore[arg-type]
        FakeDatabase(True, [revision_file()]),
        REPOSITORY_ID,
        REVISION_ID,
    )


def test_inline_media_allowlist_does_not_include_code_or_model_files() -> None:
    assert "image/png" in INLINE_MEDIA_TYPES
    assert "application/pdf" in INLINE_MEDIA_TYPES
    assert "text/html" not in INLINE_MEDIA_TYPES
    assert "application/javascript" not in INLINE_MEDIA_TYPES
    assert "application/octet-stream" not in INLINE_MEDIA_TYPES
