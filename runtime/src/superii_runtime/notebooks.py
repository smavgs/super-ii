from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from .database import RepositoryDatabase
from .settings import Settings
from .storage import ObjectStore, normalize_repository_path


@dataclass(frozen=True, slots=True)
class NotebookResult:
    session_id: UUID
    status: str
    result_sha256: str
    result_path: Path
    image_digest: str


class NotebookRunner:
    """Execute a reviewed notebook in a one-shot, no-network Docker sandbox."""

    def __init__(self, settings: Settings, store: ObjectStore) -> None:
        self.settings = settings
        self.store = store
        self.docker = shutil.which("docker")
        if self.docker is None:
            raise RuntimeError("Docker is unavailable")
        self.root = settings.storage_root / "notebooks" / "sessions"
        self.root.mkdir(mode=0o750, parents=True, exist_ok=True)

    def execute(
        self,
        *,
        repository_id: UUID,
        revision_id: UUID,
        profile_id: UUID,
        notebook_path: str,
        workspace: Path,
        database: RepositoryDatabase,
    ) -> NotebookResult:
        safe_path = normalize_repository_path(notebook_path)
        if not safe_path.lower().endswith(".ipynb"):
            raise ValueError("execution requires a .ipynb repository file")
        notebook = (workspace / Path(*safe_path.split("/"))).resolve(strict=True)
        if (
            not notebook.is_relative_to(workspace)
            or notebook.is_symlink()
            or not notebook.is_file()
        ):
            raise ValueError("reviewed notebook was not found")
        image_digest = self._image_digest()
        session_id = uuid4()
        container_name = f"superii-notebook-{session_id}"
        session_root = self.root / str(session_id)
        session_root.mkdir(mode=0o777, parents=False, exist_ok=False)
        database.create_notebook_session(
            session_id,
            repository_id,
            revision_id,
            safe_path,
            profile_id,
            image_digest,
            self.settings.notebook_cpu_limit,
            self.settings.notebook_memory_bytes,
            self.settings.notebook_pids_limit,
            self.settings.notebook_timeout_seconds,
        )
        database.transition_notebook_session(
            session_id, ["queued"], "starting", container_name=container_name
        )
        database.transition_notebook_session(
            session_id, ["starting"], "running", container_name=container_name
        )
        command = [
            self.docker,
            "run",
            "--rm",
            "--name",
            container_name,
            "--network=none",
            "--ipc=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges:true",
            f"--pids-limit={self.settings.notebook_pids_limit}",
            f"--memory={self.settings.notebook_memory_bytes}",
            f"--cpus={self.settings.notebook_cpu_limit}",
            "--ulimit=nofile=256:256",
            "--user=65532:65532",
            "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=268435456",
            "--mount",
            f"type=bind,source={workspace},target=/workspace,readonly",
            "--mount",
            f"type=bind,source={session_root},target=/output",
            f"--env=SUPERII_NOTEBOOK_PATH={safe_path}",
            (f"--env=SUPERII_NOTEBOOK_CELL_TIMEOUT={self.settings.notebook_cell_timeout_seconds}"),
            (f"--env=SUPERII_NOTEBOOK_RESULT_MAX_BYTES={self.settings.notebook_result_max_bytes}"),
            self.settings.notebook_image,
        ]
        try:
            process = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.settings.notebook_timeout_seconds,
                env=self._docker_environment(),
            )
        except subprocess.TimeoutExpired as error:
            self._remove_container(container_name)
            database.transition_notebook_session(
                session_id,
                ["running", "starting"],
                "failed",
                exit_code=124,
                failure_code="execution_timeout",
            )
            self._lock_session(session_root)
            raise TimeoutError("notebook execution exceeded its wall-clock limit") from error
        if process.returncode != 0:
            database.transition_notebook_session(
                session_id,
                ["running"],
                "failed",
                exit_code=process.returncode,
                failure_code="execution_failed",
            )
            self._lock_session(session_root)
            raise RuntimeError("isolated notebook execution failed")

        result = session_root / "executed.ipynb"
        try:
            if result.is_symlink() or not result.is_file():
                raise RuntimeError("isolated notebook execution omitted its result")
            if result.stat().st_size > self.settings.notebook_result_max_bytes:
                raise RuntimeError("isolated notebook result exceeds its size limit")
            receipt = json.loads(process.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as error:
            self._fail_session(database, session_id, session_root, "receipt_invalid")
            raise RuntimeError("notebook executor receipt is invalid") from error
        except RuntimeError as error:
            failure_code = "result_too_large" if "size limit" in str(error) else "result_missing"
            self._fail_session(database, session_id, session_root, failure_code)
            raise
        try:
            if not isinstance(receipt, dict) or receipt.get("status") != "succeeded":
                raise RuntimeError("notebook executor did not report success")
            result_sha256 = self.store.sha256(result)
            if receipt.get("result_sha256") != result_sha256:
                raise RuntimeError("notebook executor receipt checksum is invalid")
        except RuntimeError:
            self._fail_session(database, session_id, session_root, "receipt_invalid")
            raise
        self._lock_session(session_root)
        database.transition_notebook_session(
            session_id,
            ["running"],
            "succeeded",
            result_sha256=result_sha256,
            exit_code=process.returncode,
        )
        return NotebookResult(
            session_id,
            "succeeded",
            result_sha256,
            result,
            image_digest,
        )

    @staticmethod
    def _fail_session(
        database: RepositoryDatabase,
        session_id: UUID,
        session_root: Path,
        failure_code: str,
    ) -> None:
        database.transition_notebook_session(
            session_id,
            ["running"],
            "failed",
            exit_code=0,
            failure_code=failure_code,
        )
        NotebookRunner._lock_session(session_root)

    def result(self, session_id: UUID, profile_id: UUID, database: RepositoryDatabase) -> Path:
        session = database.get_notebook_session(session_id, profile_id)
        if (
            session is None
            or session["status"] != "succeeded"
            or not session["result_sha256"]
            or session["expires_at"] <= datetime.now(UTC)
        ):
            raise FileNotFoundError("executed notebook result is unavailable")
        path = (self.root / str(session_id) / "executed.ipynb").resolve()
        expected_parent = (self.root / str(session_id)).resolve()
        if path.parent != expected_parent or path.is_symlink() or not path.is_file():
            raise FileNotFoundError("executed notebook result is missing")
        if self.store.sha256(path) != session["result_sha256"]:
            raise RuntimeError("executed notebook result failed integrity verification")
        return path

    def _image_digest(self) -> str:
        inspected = subprocess.run(
            [self.docker, "image", "inspect", self.settings.notebook_image, "--format", "{{.Id}}"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
            env=self._docker_environment(),
        )
        digest = inspected.stdout.strip()
        if inspected.returncode != 0 or not digest.startswith("sha256:"):
            raise RuntimeError("pinned notebook execution image is not built")
        return digest[:200]

    def _remove_container(self, name: str) -> None:
        subprocess.run(
            [self.docker, "rm", "--force", name],
            check=False,
            capture_output=True,
            timeout=30,
            env=self._docker_environment(),
        )

    @staticmethod
    def _lock_session(path: Path) -> None:
        for child in path.iterdir():
            if child.is_file() and not child.is_symlink():
                os.chmod(child, 0o440)
        os.chmod(path, 0o550)

    @staticmethod
    def _docker_environment() -> dict[str, str]:
        allowed = {
            name: value
            for name, value in os.environ.items()
            if name in {"PATH", "DOCKER_HOST", "DOCKER_CONTEXT", "LANG", "LC_ALL"}
        }
        return allowed
