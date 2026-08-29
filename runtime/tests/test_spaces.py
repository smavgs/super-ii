from __future__ import annotations

import json
import subprocess
from pathlib import Path
from uuid import UUID

from superii_runtime.settings import Settings
from superii_runtime.spaces import SpaceRunner


def result(
    arguments: list[str], returncode: int = 0, stdout: str = ""
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(arguments, returncode, stdout, "")


def test_gradio_space_uses_the_isolated_container_contract(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "superii_runtime.spaces.shutil.which", lambda command: f"/usr/bin/{command}"
    )
    settings = Settings(storage_root=tmp_path / "runtime-data")
    runner = SpaceRunner(settings)
    repository_id = UUID("11111111-1111-4111-8111-111111111111")
    revision_id = UUID("22222222-2222-4222-8222-222222222222")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "app.py").write_text(
        "import gradio as gr\ndemo = gr.Interface(str, 'text', 'text')\n"
    )

    calls: list[list[str]] = []
    launched = False

    def fake_run(arguments: list[str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        nonlocal launched
        calls.append(arguments)
        if arguments[0] == "inspect":
            if not launched:
                return result(arguments, 1)
            return result(arguments, stdout=json.dumps({"Running": True, "Status": "running"}))
        if arguments[:2] == ["image", "inspect"]:
            return result(arguments)
        if arguments[:2] == ["network", "inspect"]:
            return result(arguments)
        if arguments[:2] == ["network", "connect"]:
            return result(arguments)
        if arguments[0] == "run":
            launched = True
            return result(arguments, stdout="container-id")
        if arguments[0] == "port":
            return result(arguments, stdout="127.0.0.1:49152\n")
        raise AssertionError(f"unexpected Docker call: {arguments}")

    monkeypatch.setattr(runner, "_run", fake_run)
    monkeypatch.setattr(runner, "_wait_until_ready", lambda local_url, root_path: None)
    status = runner.start(workspace, repository_id, revision_id)

    assert status.state == "running"
    assert status.local_url == "http://127.0.0.1:49152"
    launches = [arguments for arguments in calls if arguments[0] == "run"]
    assert len(launches) == 2
    app_launch, proxy_launch = launches
    assert app_launch[app_launch.index("--network") : app_launch.index("--network") + 2] == [
        "--network",
        runner.network_name(revision_id),
    ]
    for required in [
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--user=65532:65532",
        "--env=HF_HUB_OFFLINE=1",
        "--env=HF_DATASETS_OFFLINE=1",
        "--env=TRANSFORMERS_OFFLINE=1",
        f"--env=SUPERII_SPACE_ROOT_PATH=/api/repositories/{repository_id}/space",
    ]:
        assert required in app_launch
    assert "--publish" not in app_launch
    mount = app_launch[app_launch.index("--mount") + 1]
    assert mount.endswith(",target=/workspace,readonly")
    for required in [
        "--network",
        "bridge",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--publish",
        "127.0.0.1:0:7860",
        "--entrypoint=python",
        f"--env=SUPERII_SPACE_TARGET_HOST={runner.container_name(revision_id)}",
        "/runner/space_proxy.py",
    ]:
        assert required in proxy_launch
    assert [
        "network",
        "connect",
        runner.network_name(revision_id),
        runner.proxy_name(revision_id),
    ] in calls
    prepared_app = settings.storage_root / "spaces" / str(revision_id) / "app.py"
    assert prepared_app.read_text().startswith("import gradio")
    assert prepared_app.stat().st_mode & 0o777 == 0o444
    assert prepared_app.parent.stat().st_mode & 0o777 == 0o555


def test_gradio_space_requires_app_entrypoint(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "superii_runtime.spaces.shutil.which", lambda command: f"/usr/bin/{command}"
    )
    runner = SpaceRunner(Settings(storage_root=tmp_path / "runtime-data"))
    workspace = tmp_path / "empty"
    workspace.mkdir()

    try:
        runner.prepare(workspace, UUID("33333333-3333-4333-8333-333333333333"))
    except ValueError as error:
        assert str(error) == "Gradio Space requires app.py"
    else:
        raise AssertionError("Space preparation accepted a repository without app.py")


def test_space_build_and_logs_are_bounded(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "superii_runtime.spaces.shutil.which", lambda command: f"/usr/bin/{command}"
    )
    runner = SpaceRunner(Settings(storage_root=tmp_path / "runtime-data"))
    revision_id = UUID("44444444-4444-4444-8444-444444444444")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "app.py").write_text("print('ready')\n")

    def fake_run(arguments: list[str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        if arguments[:2] == ["image", "inspect"]:
            return result(arguments, stdout="sha256:locked-image\n")
        if arguments[0] == "logs":
            assert arguments[arguments.index("--tail") + 1] == "500"
            return result(arguments, stdout="space ready\n")
        raise AssertionError(f"unexpected Docker call: {arguments}")

    monkeypatch.setattr(runner, "_run", fake_run)
    build = runner.build(workspace, revision_id)
    assert build["status"] == "ready"
    assert build["strategy"] == "locked-image"
    assert build["file_count"] == 1
    assert runner.logs(revision_id, 50_000) == "space ready\n"
