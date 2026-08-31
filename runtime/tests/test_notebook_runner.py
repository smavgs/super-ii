import hashlib
from pathlib import Path
from subprocess import CompletedProcess
from uuid import UUID

from superii_runtime.notebooks import NotebookRunner
from superii_runtime.settings import Settings
from superii_runtime.storage import ObjectStore


class FakeDatabase:
    def __init__(self) -> None:
        self.transitions: list[tuple[list[str], str]] = []

    def create_notebook_session(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        return {"id": args[0]}

    def transition_notebook_session(
        self,
        _session_id,
        from_states,
        to_state,
        **_kwargs,  # noqa: ANN001, ANN003
    ):  # noqa: ANN201
        self.transitions.append((from_states, to_state))
        return {"status": to_state}


def test_notebook_execution_command_is_no_network_and_secret_free(
    tmp_path: Path, monkeypatch
) -> None:  # noqa: ANN001
    settings = Settings(
        storage_root=tmp_path / "data",
        notebook_timeout_seconds=30,
        notebook_cell_timeout_seconds=5,
    )
    store = ObjectStore(settings.storage_root, max_upload_bytes=1024)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "demo.ipynb").write_text("{}", encoding="utf-8")
    commands: list[list[str]] = []

    monkeypatch.setattr("superii_runtime.notebooks.shutil.which", lambda _name: "/usr/bin/docker")

    def fake_run(command, **_kwargs):  # noqa: ANN001, ANN003, ANN202
        commands.append(command)
        if command[1:3] == ["image", "inspect"]:
            return CompletedProcess(command, 0, stdout="sha256:test-image\n", stderr="")
        output_mount = next(
            item
            for item in command
            if item.startswith("type=bind,source=") and "target=/output" in item
        )
        source = output_mount.split("source=", 1)[1].split(",target=", 1)[0]
        (Path(source) / "executed.ipynb").write_text("{}", encoding="utf-8")
        return CompletedProcess(
            command,
            0,
            stdout=(
                '{"status":"succeeded","result_bytes":2,'
                f'"result_sha256":"{hashlib.sha256(b"{}").hexdigest()}"}}\n'
            ),
            stderr="",
        )

    monkeypatch.setattr("superii_runtime.notebooks.subprocess.run", fake_run)
    database = FakeDatabase()
    result = NotebookRunner(settings, store).execute(
        repository_id=UUID("11111111-1111-4111-8111-111111111111"),
        revision_id=UUID("22222222-2222-4222-8222-222222222222"),
        profile_id=UUID("33333333-3333-4333-8333-333333333333"),
        notebook_path="demo.ipynb",
        workspace=workspace,
        database=database,  # type: ignore[arg-type]
    )

    run = commands[-1]
    assert "--network=none" in run
    assert "--ipc=none" in run
    assert "--read-only" in run
    assert "--cap-drop=ALL" in run
    assert "--security-opt=no-new-privileges:true" in run
    assert "--user=65532:65532" in run
    assert "--ulimit=nofile=256:256" in run
    assert all("TOKEN" not in value and "SECRET" not in value for value in run)
    assert database.transitions[-1][1] == "succeeded"
    assert result.result_sha256 == store.sha256(result.result_path)
