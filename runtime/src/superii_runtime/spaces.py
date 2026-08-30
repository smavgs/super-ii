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

NETWORK_PREFIX = "superii-space-network-"


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

    @staticmethod
    def network_name(revision_id: UUID) -> str:
        return f"{NETWORK_PREFIX}{revision_id}"

    def _run(self, arguments: list[str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self.docker, *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def ensure_internal_network(self, revision_id: UUID) -> str:
        network_name = self.network_name(revision_id)
        inspected = self._run(["network", "inspect", network_name])
        if inspected.returncode == 0:
            return network_name
        created = self._run(
            [
                "network",
                "create",
                "--internal",
                "--label",
                f"site.superii.space-revision={revision_id}",
                network_name,
            ]
        )
        if created.returncode != 0:
            raise RuntimeError("isolated Spaces network could not be created")
        return network_name

    def _remove_network(self, revision_id: UUID) -> None:
        network_name = self.network_name(revision_id)
        inspected = self._run(["network", "inspect", network_name])
        if inspected.returncode != 0:
            return
        removed = self._run(["network", "rm", network_name], timeout=30)
        if removed.returncode != 0:
            raise RuntimeError("stale Space network could not be removed")

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
            self._lock_bundle(target)
            return target
        temporary = spaces_root / f".{revision_id}.preparing"
        if temporary.exists():
            raise RuntimeError("Space preparation is already in progress")
        shutil.copytree(workspace, temporary, symlinks=False)
        self._lock_bundle(temporary)
        os.replace(temporary, target)
        return target

    @staticmethod
    def _lock_bundle(bundle: Path) -> None:
        # The sandbox user must be able to traverse the immutable bundle root.
        os.chmod(bundle, 0o555)  # noqa: S103
        for path in bundle.rglob("*"):
            os.chmod(path, 0o555 if path.is_dir() else 0o444)

    def build(self, workspace: Path, revision_id: UUID) -> dict[str, str | int]:
        """Prepare an immutable app bundle against the pinned, prebuilt runtime image."""

        image = self._run(["image", "inspect", self.settings.spaces_image, "--format", "{{.Id}}"])
        if image.returncode != 0:
            raise RuntimeError("pinned Super ii Gradio image is not built")
        prepared = self.prepare(workspace, revision_id)
        files = [path for path in prepared.rglob("*") if path.is_file()]
        return {
            "status": "ready",
            "strategy": "locked-image",
            "image": self.settings.spaces_image,
            "image_id": image.stdout.strip()[:200],
            "file_count": len(files),
        }

    def logs(self, revision_id: UUID, tail: int = 200) -> str:
        bounded_tail = min(max(tail, 1), 500)
        result = self._run(
            [
                "logs",
                "--timestamps",
                "--tail",
                str(bounded_tail),
                self.container_name(revision_id),
            ],
            timeout=20,
        )
        if result.returncode != 0:
            if self.status(revision_id).state == "missing":
                return ""
            raise RuntimeError("Space logs are unavailable")
        combined = f"{result.stdout}{result.stderr}"
        return combined[-200_000:]

    def start(self, workspace: Path, repository_id: UUID, revision_id: UUID) -> SpaceStatus:
        existing = self.status(revision_id)
        if existing.state == "running" and existing.local_url:
            return existing
        image = self._run(["image", "inspect", self.settings.spaces_image])
        if image.returncode != 0:
            raise RuntimeError("pinned Super ii Gradio image is not built")
        network_name = self.ensure_internal_network(revision_id)
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
                network_name,
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
            self._remove_network(revision_id)
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
            self._remove_network(revision_id)
            raise RuntimeError("trusted Space proxy container failed to start")
        connected = self._run(["network", "connect", network_name, proxy_name])
        if connected.returncode != 0:
            self._remove(proxy_name)
            self._remove(name)
            self._remove_network(revision_id)
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
            self._remove_network(revision_id)
            return existing
        self._remove(name)
        self._remove_network(revision_id)
        return SpaceStatus(name, "stopped", None)
