from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .settings import Settings
from .storage import StagedObject, StoredObject


@dataclass(frozen=True, slots=True)
class RevisionFile:
    id: UUID
    repository_id: UUID
    revision_id: UUID
    path: str
    size_bytes: int
    mime_type: str
    sha256: str
    storage_key: str


class RepositoryDatabase:
    """Small transactional adapter; SQL migrations remain the source of truth."""

    def __init__(self, settings: Settings) -> None:
        self.database_url = settings.require_database_url()

    @contextmanager
    def connect(self) -> Iterator[Connection[dict[str, Any]]]:
        with psycopg.connect(
            self.database_url,
            row_factory=dict_row,
            connect_timeout=10,
            application_name="superii-runtime",
        ) as connection:
            yield connection

    def ping(self) -> bool:
        try:
            with self.connect() as connection:
                connection.execute("select 1")
            return True
        except psycopg.Error:
            return False

    def create_revision(
        self,
        repository_id: UUID,
        parent_revision_id: UUID | None,
        message: str,
        created_by: str,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                select *
                from app.create_repository_revision(%s, %s, %s, %s)
                """,
                (repository_id, parent_revision_id, message, created_by),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the new revision")
            return row

    def register_staged_file(
        self,
        repository_id: UUID,
        revision_id: UUID,
        staged: StagedObject,
        created_by: str,
    ) -> UUID:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                    insert into app.repository_files (
                      repository_id,
                      revision_id,
                      path,
                      size_bytes,
                      mime_type,
                      sha256,
                      storage_key,
                      storage_state,
                      scan_status,
                      created_by
                    ) values (%s, %s, %s, %s, %s, %s, %s, 'quarantine', 'pending', %s)
                    returning id
                    """,
                (
                    repository_id,
                    revision_id,
                    staged.path,
                    staged.size_bytes,
                    staged.mime_type,
                    staged.sha256,
                    staged.storage_key,
                    created_by,
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the new file")
            connection.execute(
                """
                    update app.repository_revisions
                    set status = 'quarantined',
                        file_count = file_count + 1,
                        total_size_bytes = total_size_bytes + %s
                    where id = %s and repository_id = %s and status in ('draft', 'quarantined')
                    """,
                (staged.size_bytes, revision_id, repository_id),
            )
            return row["id"]

    def set_revision_status(self, revision_id: UUID, status: str) -> None:
        if status not in {"quarantined", "scanning", "review", "rejected"}:
            raise ValueError("unsupported runtime revision transition")
        with self.connect() as connection:
            connection.execute(
                "update app.repository_revisions set status = %s where id = %s",
                (status, revision_id),
            )

    def record_inspection(
        self,
        repository_file_id: UUID,
        inspector: str,
        status: str,
        tool_version: str | None,
        result: dict[str, Any],
    ) -> UUID:
        with self.connect() as connection:
            row = connection.execute(
                """
                insert into app.repository_file_inspections (
                  repository_file_id,
                  inspector,
                  status,
                  tool_version,
                  result,
                  completed_at
                ) values (%s, %s, %s, %s, %s, now())
                returning id
                """,
                (repository_file_id, inspector, status, tool_version, Jsonb(result)),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the inspection")
            return row["id"]

    def mark_file_available(self, repository_file_id: UUID, stored: StoredObject) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update app.repository_files
                set storage_key = %s, storage_state = 'available', scan_status = 'clean'
                where id = %s and sha256 = %s
                """,
                (stored.storage_key, repository_file_id, stored.sha256),
            )

    def mark_file_rejected(self, repository_file_id: UUID, scan_status: str = "failed") -> None:
        if scan_status not in {"failed", "error"}:
            raise ValueError("rejected file must be failed or error")
        with self.connect() as connection:
            connection.execute(
                """
                update app.repository_files
                set storage_state = 'rejected', scan_status = %s
                where id = %s
                """,
                (scan_status, repository_file_id),
            )

    def mark_file_scan_error(self, repository_file_id: UUID) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update app.repository_files
                set storage_state = 'quarantine', scan_status = 'error'
                where id = %s
                """,
                (repository_file_id,),
            )

    def list_revision_files(self, revision_id: UUID) -> list[RevisionFile]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                select id, repository_id, revision_id, path, size_bytes,
                       mime_type, sha256, storage_key
                from app.repository_files
                where revision_id = %s and storage_state = 'available' and scan_status = 'clean'
                order by path
                """,
                (revision_id,),
            ).fetchall()
        return [RevisionFile(**row) for row in rows]

    def get_revision_file(self, repository_file_id: UUID) -> RevisionFile | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                select id, repository_id, revision_id, path, size_bytes,
                       mime_type, sha256, storage_key
                from app.repository_files
                where id = %s and storage_state = 'available' and scan_status = 'clean'
                """,
                (repository_file_id,),
            ).fetchone()
        return RevisionFile(**row) if row else None

    def revision_is_public(self, repository_id: UUID, revision_id: UUID) -> bool:
        """Require the exact approved revision currently published by a public repository."""

        with self.connect() as connection:
            row = connection.execute(
                """
                select exists (
                  select 1
                  from app.repositories r
                  join app.repository_revisions rr on rr.id = r.latest_revision_id
                  where r.id = %s
                    and rr.id = %s
                    and r.visibility = 'public'
                    and r.status = 'published'
                    and rr.status = 'published'
                ) as is_public
                """,
                (repository_id, revision_id),
            ).fetchone()
        return bool(row and row["is_public"])

    def record_download(
        self,
        file: RevisionFile,
        bytes_sent: int,
        user_agent: str | None,
        network_hash: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                insert into app.repository_downloads (
                  repository_id,
                  revision_id,
                  repository_file_id,
                  network_hash,
                  user_agent,
                  bytes_sent
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    file.repository_id,
                    file.revision_id,
                    file.id,
                    network_hash,
                    (user_agent or "")[:1000] or None,
                    bytes_sent,
                ),
            )

    def revision_is_ready_for_review(self, revision_id: UUID) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select
                  count(*) > 0 as has_files,
                  bool_and(storage_state = 'available' and scan_status = 'clean') as all_clean
                from app.repository_files
                where revision_id = %s
                """,
                (revision_id,),
            ).fetchone()
        return bool(row and row["has_files"] and row["all_clean"])

    def revision_analysis_passed(self, repository_id: UUID, revision_id: UUID) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select exists (
                  select 1
                  from app.repository_revision_analyses a
                  join app.repositories r on r.id = a.repository_id
                  where r.id = %s
                    and a.revision_id = %s
                    and a.analysis_type = r.kind::text
                    and a.status = 'passed'
                ) as passed
                """,
                (repository_id, revision_id),
            ).fetchone()
        return bool(row and row["passed"])

    def save_revision_analysis(
        self,
        repository_id: UUID,
        revision_id: UUID,
        analysis_type: str,
        status: str,
        result: dict[str, Any],
        tool_versions: dict[str, str],
    ) -> UUID:
        with self.connect() as connection:
            row = connection.execute(
                """
                insert into app.repository_revision_analyses (
                  repository_id,
                  revision_id,
                  analysis_type,
                  status,
                  result,
                  tool_versions,
                  completed_at
                ) values (%s, %s, %s, %s, %s, %s, now())
                on conflict (revision_id, analysis_type) do update set
                  status = excluded.status,
                  result = excluded.result,
                  tool_versions = excluded.tool_versions,
                  completed_at = excluded.completed_at,
                  updated_at = now()
                returning id
                """,
                (
                    repository_id,
                    revision_id,
                    analysis_type,
                    status,
                    Jsonb(result),
                    Jsonb(tool_versions),
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the analysis")
            return row["id"]

    def update_revision_manifest(
        self,
        revision_id: UUID,
        manifest_sha256: str,
        file_count: int,
        total_size_bytes: int,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update app.repository_revisions
                set manifest_sha256 = %s, file_count = %s, total_size_bytes = %s
                where id = %s
                """,
                (manifest_sha256, file_count, total_size_bytes, revision_id),
            )
