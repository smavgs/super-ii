from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx

from .settings import Settings

NETWORK_NAME = "superii-spaces-internal"


@dataclass(frozen=True, slots=True)
class SpaceStatus:
    container_name: str
    state: str
    local_url: str | None


class SpaceRunner:
    """Runs one reviewed Gradio revision in a constrained, no-egress container."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.docker = shutil.which("docker")
        if self.docker is None:
            raise RuntimeError("Docker is unavailable")

    @staticmethod
    def container_name(revision_id: UUID) -> str:
        return f"superii-space-{str(revision_id)}"

    @classmethod
    def proxy_name(cls, revision_id: UUID) -> str:
        return f"{cls.container_name(revision_id)}-proxy"

    def _run(self, arguments: list[str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self.docker, *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def ensure_internal_network(self) -> None:
        inspected = self._run(["network", "inspect", NETWORK_NAME])
        if inspected.returncode == 0:
            return
        created = self._run(["network", "create", "--internal", NETWORK_NAME])
        if created.returncode != 0:
            raise RuntimeError("isolated Spaces network could not be created")

    def _remove(self, container_name: str) -> None:
        inspected = self._run(["inspect", container_name])
        if inspected.returncode != 0:
            return
        removed = self._run(["rm", "--force", container_name], timeout=30)
        if removed.returncode != 0:
            raise RuntimeError("stale Space container could not be removed")

    def prepare(self, workspace: Path, revision_id: UUID) -> Path:
        if not (workspace / "app.py").is_file():
            raise ValueError("Gradio Space requires app.py")
        spaces_root = self.settings.storage_root / "spaces"
        spaces_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = spaces_root / str(revision_id)
        if target.exists():
            return target
        temporary = spaces_root / f".{revision_id}.preparing"
        if temporary.exists():
            raise RuntimeError("Space preparation is already in progress")
        shutil.copytree(workspace, temporary, symlinks=False)
        for path in temporary.rglob("*"):
            os.chmod(path, 0o555 if path.is_dir() else 0o444)
        os.replace(temporary, target)
        return target

    def start(self, workspace: Path, repository_id: UUID, revision_id: UUID) -> SpaceStatus:
        existing = self.status(revision_id)
        if existing.state == "running" and existing.local_url:
            return existing
        image = self._run(["image", "inspect", self.settings.spaces_image])
        if image.returncode != 0:
            raise RuntimeError("pinned Super ii Gradio image is not built")
        self.ensure_internal_network()
        prepared = self.prepare(workspace, revision_id)
        name = self.container_name(revision_id)
        proxy_name = self.proxy_name(revision_id)
        self._remove(proxy_name)
        self._remove(name)
        launched = self._run(
            [
                "run",
                "--detach",
                "--name",
                name,
                "--network",
                NETWORK_NAME,
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=268435456",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges:true",
                f"--pids-limit={self.settings.space_pids_limit}",
                f"--memory={self.settings.space_memory_limit}",
                f"--cpus={self.settings.space_cpu_limit}",
                "--user=65532:65532",
                "--env=HF_HUB_OFFLINE=1",
                "--env=HF_DATASETS_OFFLINE=1",
                "--env=HF_HUB_DISABLE_TELEMETRY=1",
                "--env=TRANSFORMERS_OFFLINE=1",
                "--env=GRADIO_ANALYTICS_ENABLED=False",
                (f"--env=SUPERII_SPACE_ROOT_PATH=/api/repositories/{repository_id}/space"),
                "--mount",
                f"type=bind,source={prepared},target=/workspace,readonly",
                self.settings.spaces_image,
            ],
            timeout=120,
        )
        if launched.returncode != 0:
            raise RuntimeError("Gradio Space container failed to start")
        proxy = self._run(
            [
                "run",
                "--detach",
                "--name",
                proxy_name,
                "--network",
                "bridge",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges:true",
                "--pids-limit=64",
                "--memory=128m",
                "--cpus=0.25",
                "--user=65532:65532",
                f"--env=SUPERII_SPACE_TARGET_HOST={name}",
                "--publish",
                "127.0.0.1:0:7860",
                "--entrypoint=python",
                self.settings.spaces_image,
                "/runner/space_proxy.py",
            ],
            timeout=120,
        )
        if proxy.returncode != 0:
            self._remove(name)
            raise RuntimeError("trusted Space proxy container failed to start")
        connected = self._run(["network", "connect", NETWORK_NAME, proxy_name])
        if connected.returncode != 0:
            self._remove(proxy_name)
            self._remove(name)
            raise RuntimeError("trusted Space proxy could not join the isolated network")
        status = self.status(revision_id)
        if not status.local_url:
            self.stop(revision_id)
            raise RuntimeError("trusted Space proxy did not publish a local endpoint")
        root_path = f"/api/repositories/{repository_id}/space/"
        try:
            self._wait_until_ready(status.local_url, root_path)
        except RuntimeError:
            self.stop(revision_id)
            raise
        return status

    def _wait_until_ready(self, local_url: str, root_path: str) -> None:
        deadline = time.monotonic() + self.settings.space_start_timeout_seconds
        while time.monotonic() < deadline:
            try:
                response = httpx.get(
                    f"{local_url.rstrip('/')}{root_path}",
                    timeout=2,
                    follow_redirects=True,
                )
                if response.is_success:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        raise RuntimeError("Gradio Space did not become ready before the startup deadline")

    def status(self, revision_id: UUID) -> SpaceStatus:
        name = self.container_name(revision_id)
        inspected = self._run(["inspect", name, "--format", "{{json .State}}"])
        if inspected.returncode != 0:
            return SpaceStatus(name, "missing", None)
        try:
            state = json.loads(inspected.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("Docker returned an invalid container state") from error
        running = bool(state.get("Running"))
        state_name = "running" if running else str(state.get("Status", "stopped"))
        local_url = None
        if running:
            proxy_name = self.proxy_name(revision_id)
            proxy = self._run(["inspect", proxy_name, "--format", "{{json .State}}"])
            if proxy.returncode == 0:
                try:
                    proxy_state = json.loads(proxy.stdout)
                except json.JSONDecodeError as error:
                    raise RuntimeError("Docker returned an invalid proxy state") from error
                if bool(proxy_state.get("Running")):
                    port = self._run(["port", proxy_name, "7860/tcp"])
                    if port.returncode == 0 and port.stdout.strip():
                        endpoint = port.stdout.strip().splitlines()[0]
                        local_url = f"http://{endpoint}"
            if local_url is None:
                state_name = "proxy_unavailable"
        return SpaceStatus(name, state_name, local_url)

    def stop(self, revision_id: UUID) -> SpaceStatus:
        name = self.container_name(revision_id)
        existing = self.status(revision_id)
        proxy_name = self.proxy_name(revision_id)
        self._remove(proxy_name)
        if existing.state == "missing":
            return existing
        self._remove(name)
        return SpaceStatus(name, "stopped", None)
