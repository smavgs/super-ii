from __future__ import annotations

import json
import tempfile
from pathlib import Path
from uuid import UUID

import httpx

from superii_runtime.settings import Settings
from superii_runtime.spaces import NETWORK_NAME, SpaceRunner

REPOSITORY_ID = UUID("11111111-1111-4111-8111-111111111111")
REVISION_ID = UUID("55555555-5555-4555-8555-555555555555")


def inspect(runner: SpaceRunner, name: str) -> dict[str, object]:
    result = runner._run(["inspect", name])
    if result.returncode != 0:
        raise RuntimeError(f"Docker could not inspect {name}")
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise RuntimeError("Docker returned an invalid inspection document")
    return rows[0]


def main() -> None:
    fixture = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "gradio_space"
    with tempfile.TemporaryDirectory(prefix="superii-space-smoke-") as temporary:
        runner = SpaceRunner(
            Settings(
                storage_root=Path(temporary) / "data",
                space_start_timeout_seconds=60,
            )
        )
        name = runner.container_name(REVISION_ID)
        proxy_name = runner.proxy_name(REVISION_ID)
        try:
            status = runner.start(fixture, REPOSITORY_ID, REVISION_ID)
            if status.state != "running" or not status.local_url:
                raise RuntimeError("Space did not report a reachable state")
            root_path = f"/api/repositories/{REPOSITORY_ID}/space/"
            response = httpx.get(
                f"{status.local_url}{root_path}",
                timeout=5,
                follow_redirects=True,
            )
            response.raise_for_status()
            if root_path not in response.text:
                raise RuntimeError("Gradio did not render its scoped root path")

            app = inspect(runner, name)
            app_host = app.get("HostConfig")
            app_network = app.get("NetworkSettings")
            if not isinstance(app_host, dict) or not isinstance(app_network, dict):
                raise RuntimeError("Space isolation metadata is missing")
            if app_host.get("ReadonlyRootfs") is not True:
                raise RuntimeError("Space filesystem is not read only")
            if app_host.get("NetworkMode") != NETWORK_NAME:
                raise RuntimeError("Space is not attached exclusively to the internal network")
            networks = app_network.get("Networks")
            if not isinstance(networks, dict) or set(networks) != {NETWORK_NAME}:
                raise RuntimeError("Space has an unexpected network attachment")
            egress = runner._run(
                [
                    "exec",
                    name,
                    "python",
                    "-c",
                    "import socket; socket.create_connection(('1.1.1.1', 443), 2)",
                ],
                timeout=5,
            )
            if egress.returncode == 0:
                raise RuntimeError("Space unexpectedly reached the public internet")

            proxy = inspect(runner, proxy_name)
            proxy_host = proxy.get("HostConfig")
            proxy_network = proxy.get("NetworkSettings")
            if not isinstance(proxy_host, dict) or not isinstance(proxy_network, dict):
                raise RuntimeError("trusted proxy isolation metadata is missing")
            if proxy_host.get("ReadonlyRootfs") is not True:
                raise RuntimeError("trusted proxy filesystem is not read only")
            proxy_networks = proxy_network.get("Networks")
            if not isinstance(proxy_networks, dict) or set(proxy_networks) != {
                "bridge",
                NETWORK_NAME,
            }:
                raise RuntimeError("trusted proxy network bridge is incomplete")
            ports = proxy_network.get("Ports")
            published = ports.get("7860/tcp") if isinstance(ports, dict) else None
            if not isinstance(published, list) or published[0].get("HostIp") != "127.0.0.1":
                raise RuntimeError("trusted proxy is not bound only to localhost")
            print(
                "OK: isolated Gradio app has no egress and is reachable only through "
                f"the trusted localhost proxy at {status.local_url}"
            )
        finally:
            runner.stop(REVISION_ID)


if __name__ == "__main__":
    main()
