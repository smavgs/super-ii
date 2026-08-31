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

    def get_resumable_upload(self, upload_id: UUID) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "select * from app.repository_uploads where id = %s",
                (upload_id,),
            ).fetchone()
        return dict(row) if row else None

    def prepare_resumable_scan(
        self,
        upload_id: UUID,
        staged: StagedObject,
    ) -> tuple[dict[str, Any], UUID]:
        """Atomically bind verified transfer bytes to one quarantined repository file."""

        with self.connect() as connection, connection.transaction():
            upload = connection.execute(
                "select * from app.repository_uploads where id = %s for update",
                (upload_id,),
            ).fetchone()
            if upload is None:
                raise RuntimeError("resumable upload was not found")
            if upload["state"] not in {"uploaded", "scanning"}:
                raise RuntimeError("resumable upload is not ready for scanning")
            if (
                int(upload["offset_bytes"]) != int(upload["expected_size_bytes"])
                or int(upload["expected_size_bytes"]) != staged.size_bytes
                or upload["expected_sha256"] != staged.sha256
                or upload["path"] != staged.path
            ):
                raise RuntimeError("resumable upload metadata does not match verified bytes")

            file_id = upload["repository_file_id"]
            if file_id is None:
                inserted = connection.execute(
                    """
                    insert into app.repository_files (
                      repository_id, revision_id, path, size_bytes, mime_type,
                      sha256, storage_key, storage_state, scan_status, created_by,
                      integrity_state
                    ) values (%s, %s, %s, %s, %s, %s, %s,
                      'quarantine', 'running', %s, 'unverified')
                    returning id
                    """,
                    (
                        upload["repository_id"],
                        upload["revision_id"],
                        staged.path,
                        staged.size_bytes,
                        staged.mime_type,
                        staged.sha256,
                        staged.storage_key,
                        upload["created_by"] or "runtime:resumable-transfer",
                    ),
                ).fetchone()
                if inserted is None:
                    raise RuntimeError("database did not return the resumable file")
                file_id = inserted["id"]
                connection.execute(
                    """
                    update app.repository_revisions
                    set status = 'scanning',
                        file_count = file_count + 1,
                        total_size_bytes = total_size_bytes + %s
                    where id = %s and repository_id = %s
                      and status in ('draft', 'quarantined', 'scanning')
                    """,
                    (
                        staged.size_bytes,
                        upload["revision_id"],
                        upload["repository_id"],
                    ),
                )
            else:
                connection.execute(
                    """
                    update app.repository_files
                    set scan_status = 'running'
                    where id = %s and storage_state = 'quarantine'
                    """,
                    (file_id,),
                )

            updated = connection.execute(
                """
                update app.repository_uploads
                set state = 'scanning', actual_sha256 = %s,
                    repository_file_id = %s, error_code = null,
                    last_activity_at = now(), updated_at = now()
                where id = %s and state in ('uploaded', 'scanning')
                returning *
                """,
                (staged.sha256, file_id, upload_id),
            ).fetchone()
            if updated is None:
                raise RuntimeError("resumable scan transition conflicted")
            return dict(updated), file_id

    def complete_resumable_upload(
        self,
        upload_id: UUID,
        repository_file_id: UUID,
        stored: StoredObject,
        size_bytes: int,
        receipt: dict[str, Any],
    ) -> None:
        with self.connect() as connection, connection.transaction():
            file_row = connection.execute(
                """
                update app.repository_files
                set storage_key = %s, storage_state = 'available', scan_status = 'clean',
                    integrity_state = 'verified', integrity_verified_at = now(),
                    integrity_receipt = %s
                where id = %s and sha256 = %s and storage_state in ('quarantine', 'available')
                returning revision_id
                """,
                (stored.storage_key, Jsonb(receipt), repository_file_id, stored.sha256),
            ).fetchone()
            if file_row is None:
                raise RuntimeError("resumable file could not be marked available")
            upload = connection.execute(
                """
                update app.repository_uploads
                set state = 'ready', actual_sha256 = %s, repository_file_id = %s,
                    receipt = %s, error_code = null, completed_at = now(),
                    last_activity_at = now(), updated_at = now()
                where id = %s and state in ('scanning', 'ready')
                returning revision_id
                """,
                (stored.sha256, repository_file_id, Jsonb(receipt), upload_id),
            ).fetchone()
            if upload is None:
                raise RuntimeError("resumable upload could not be completed")
            connection.execute(
                """
                insert into app.cas_integrity_events (
                  sha256, event_type, size_bytes, receipt
                ) values (%s, 'promoted', %s, %s)
                """,
                (stored.sha256, size_bytes, Jsonb(receipt)),
            )
            connection.execute(
                "update app.repository_revisions set status = 'quarantined' where id = %s",
                (upload["revision_id"],),
            )

    def reject_resumable_upload(
        self,
        upload_id: UUID,
        repository_file_id: UUID,
        error_code: str,
        receipt: dict[str, Any],
    ) -> None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                update app.repository_uploads
                set state = 'rejected', error_code = %s, receipt = %s,
                    completed_at = now(), last_activity_at = now(), updated_at = now()
                where id = %s and state in ('uploaded', 'scanning', 'rejected')
                returning revision_id
                """,
                (error_code[:120], Jsonb(receipt), upload_id),
            ).fetchone()
            if row is None:
                raise RuntimeError("resumable upload rejection conflicted")
            connection.execute(
                """
                update app.repository_files
                set storage_state = 'rejected', scan_status = 'failed'
                where id = %s
                """,
                (repository_file_id,),
            )
            connection.execute(
                "update app.repository_revisions set status = 'rejected' where id = %s",
                (row["revision_id"],),
            )

    def hold_resumable_upload(
        self,
        upload_id: UUID,
        repository_file_id: UUID,
        error_code: str,
        receipt: dict[str, Any],
    ) -> None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                update app.repository_uploads
                set state = 'scanning', error_code = %s, receipt = %s,
                    last_activity_at = now(), updated_at = now()
                where id = %s and state = 'scanning'
                returning revision_id
                """,
                (error_code[:120], Jsonb(receipt), upload_id),
            ).fetchone()
            if row is None:
                raise RuntimeError("resumable upload hold conflicted")
            connection.execute(
                """
                update app.repository_files
                set storage_state = 'quarantine', scan_status = 'error'
                where id = %s
                """,
                (repository_file_id,),
            )
            connection.execute(
                "update app.repository_revisions set status = 'quarantined' where id = %s",
                (row["revision_id"],),
            )

    def record_model_instance(
        self,
        repository_id: UUID,
        revision_id: UUID,
        model_path: str,
        model_sha256: str,
        status: str,
        endpoint_id: str | None,
        *,
        idle_seconds: int = 900,
        cold_start_ms: int | None = None,
        failure_code: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> UUID:
        with self.connect() as connection:
            row = connection.execute(
                """
                insert into app.runtime_model_instances (
                  repository_id, revision_id, model_path, model_sha256,
                  status, endpoint_id, cold_start_ms, last_used_at,
                  idle_expires_at, failure_code, runtime_metadata
                ) values (%s, %s, %s, %s, %s, %s, %s, now(),
                  now() + make_interval(secs => %s), %s, %s)
                on conflict (revision_id, model_path) do update set
                  model_sha256 = excluded.model_sha256,
                  status = excluded.status,
                  endpoint_id = excluded.endpoint_id,
                  cold_start_ms = coalesce(
                    excluded.cold_start_ms,
                    runtime_model_instances.cold_start_ms
                  ),
                  last_used_at = now(),
                  idle_expires_at = excluded.idle_expires_at,
                  failure_code = excluded.failure_code,
                  runtime_metadata = excluded.runtime_metadata,
                  updated_at = now()
                returning id
                """,
                (
                    repository_id,
                    revision_id,
                    model_path,
                    model_sha256,
                    status,
                    endpoint_id,
                    cold_start_ms,
                    idle_seconds,
                    failure_code,
                    Jsonb(metadata or {}),
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the model instance")
            return row["id"]

    def record_model_request(
        self, revision_id: UUID, model_path: str, idle_seconds: int = 900
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update app.runtime_model_instances
                set status = 'ready', request_count = request_count + 1,
                    last_used_at = now(),
                    idle_expires_at = now() + make_interval(secs => %s),
                    failure_code = null, updated_at = now()
                where revision_id = %s and model_path = %s
                """,
                (idle_seconds, revision_id, model_path),
            )

    def stop_model_instance(
        self,
        revision_id: UUID,
        model_path: str,
        *,
        failure_code: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update app.runtime_model_instances
                set status = %s, endpoint_id = null, failure_code = %s,
                    idle_expires_at = null, updated_at = now()
                where revision_id = %s and model_path = %s
                """,
                ("failed" if failure_code else "stopped", failure_code, revision_id, model_path),
            )

    def create_notebook_session(
        self,
        session_id: UUID,
        repository_id: UUID,
        revision_id: UUID,
        notebook_path: str,
        profile_id: UUID,
        image_digest: str,
        cpu_limit: float,
        memory_limit_bytes: int,
        pids_limit: int,
        timeout_seconds: int,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                insert into app.notebook_execution_sessions (
                  id, repository_id, revision_id, notebook_path, profile_id,
                  image_digest, cpu_limit, memory_limit_bytes, pids_limit,
                  network_disabled, secrets_injected, timeout_seconds, expires_at
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                  true, false, %s, now() + interval '24 hours')
                returning *
                """,
                (
                    session_id,
                    repository_id,
                    revision_id,
                    notebook_path,
                    profile_id,
                    image_digest,
                    cpu_limit,
                    memory_limit_bytes,
                    pids_limit,
                    timeout_seconds,
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the notebook session")
            return dict(row)

    def transition_notebook_session(
        self,
        session_id: UUID,
        from_states: list[str],
        to_state: str,
        *,
        container_name: str | None = None,
        result_sha256: str | None = None,
        exit_code: int | None = None,
        failure_code: str | None = None,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                select * from app.transition_notebook_execution(
                  %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    session_id,
                    from_states,
                    to_state,
                    container_name,
                    result_sha256,
                    exit_code,
                    failure_code,
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the notebook transition")
            return dict(row)

    def get_notebook_session(
        self, session_id: UUID, profile_id: UUID | None = None
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            if profile_id is None:
                row = connection.execute(
                    "select * from app.notebook_execution_sessions where id = %s",
                    (session_id,),
                ).fetchone()
            else:
                row = connection.execute(
                    """
                    select * from app.notebook_execution_sessions
                    where id = %s and profile_id = %s
                    """,
                    (session_id, profile_id),
                ).fetchone()
        return dict(row) if row else None

    def record_benchmark(self, benchmark: dict[str, Any]) -> UUID:
        if benchmark.get("claim_scope") != "local measurement only":
            raise ValueError("benchmark claim scope must remain local")
        with self.connect() as connection:
            row = connection.execute(
                """
                insert into app.runtime_benchmark_records (
                  category, runtime, runtime_version, model_sha256,
                  hardware, parameters, metrics, provenance, claim_scope, measured_at
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    benchmark["category"],
                    benchmark["runtime"],
                    benchmark.get("runtime_version"),
                    benchmark.get("model_sha256"),
                    Jsonb(benchmark["hardware"]),
                    Jsonb(benchmark["parameters"]),
                    Jsonb(benchmark["metrics"]),
                    Jsonb(benchmark["provenance"]),
                    benchmark["claim_scope"],
                    benchmark["measured_at"],
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("database did not return the benchmark record")
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
        manifest: list[dict[str, Any]],
    ) -> str:
        with self.connect() as connection:
            row = connection.execute(
                """
                update app.repository_revisions
                set manifest_sha256 = %s,
                    file_count = %s,
                    total_size_bytes = %s,
                    manifest = %s,
                    commit_sha = encode(digest(
                      coalesce((
                        select parent.commit_sha
                        from app.repository_revisions parent
                        where parent.id = repository_revisions.parent_revision_id
                      ), '')
                      || E'\\n' || %s || E'\\n' || message || E'\\n' || id::text,
                      'sha256'
                    ), 'hex')
                where id = %s
                returning commit_sha
                """,
                (
                    manifest_sha256,
                    file_count,
                    total_size_bytes,
                    Jsonb(manifest),
                    manifest_sha256,
                    revision_id,
                ),
            ).fetchone()
            if row is None:
                raise RuntimeError("revision manifest was not stored")
            return str(row["commit_sha"])
