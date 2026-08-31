from pathlib import Path
from uuid import UUID

from superii_runtime.runtimes.llama_server import LlamaServerPool
from superii_runtime.settings import Settings


class FakeProcess:
    def __init__(self) -> None:
        self.returncode = None

    def poll(self):  # noqa: ANN201
        return self.returncode

    def terminate(self) -> None:
        self.returncode = 0

    def wait(self, timeout=None):  # noqa: ANN001, ANN201
        return self.returncode

    def kill(self) -> None:
        self.returncode = -9


class FakeResponse:
    status_code = 200

    def __init__(self, payload=None) -> None:  # noqa: ANN001
        self.payload = payload or {"status": "ok"}

    def json(self):  # noqa: ANN201
        return self.payload


class FakeClient:
    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *_args) -> None:  # noqa: ANN002
        pass

    def get(self, _url):  # noqa: ANN001, ANN201
        return FakeResponse()

    def post(self, path, json):  # noqa: ANN001, ANN201
        assert path == "/completion"
        assert json["stream"] is False
        return FakeResponse({"content": "persistent answer", "timings": {"predicted_n": 2}})

    def close(self) -> None:
        pass


class FakeDatabase:
    def __init__(self) -> None:
        self.events: list[str] = []

    def record_model_instance(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        self.events.append(str(args[4]))
        return UUID("44444444-4444-4444-8444-444444444444")

    def record_model_request(self, _revision_id, _model_path, _idle_seconds) -> None:  # noqa: ANN001
        self.events.append("request")

    def stop_model_instance(self, _revision_id, _model_path, **_kwargs) -> None:  # noqa: ANN001, ANN003
        self.events.append("stopped")


def test_llama_server_is_persistent_loopback_only(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    settings = Settings(storage_root=tmp_path / "data", llama_server_start_timeout_seconds=10)
    model = tmp_path / "model.gguf"
    model.write_bytes(b"gguf")
    command: list[str] = []
    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_server.shutil.which", lambda _name: "/bin/llama-server"
    )
    monkeypatch.setattr("superii_runtime.runtimes.llama_server.httpx.Client", FakeClient)

    def fake_popen(arguments, **_kwargs):  # noqa: ANN001, ANN003, ANN202
        command.extend(arguments)
        return FakeProcess()

    monkeypatch.setattr("superii_runtime.runtimes.llama_server.subprocess.Popen", fake_popen)
    database = FakeDatabase()
    pool = LlamaServerPool()
    result = pool.generate(
        repository_id=UUID("11111111-1111-4111-8111-111111111111"),
        revision_id=UUID("22222222-2222-4222-8222-222222222222"),
        model_path="model.gguf",
        model_sha256="a" * 64,
        model=model,
        settings=settings,
        database=database,  # type: ignore[arg-type]
        prompt="hello",
        max_tokens=8,
        temperature=0.7,
        top_p=0.95,
        seed=1,
    )

    assert result["text"] == "persistent answer"
    assert result["persistent"] is True
    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert "--cont-batching" in command
    assert "--no-webui" in command
    assert pool.status()["state"] == "ready"
    assert database.events[:3] == ["starting", "ready", "request"]
    pool.close()
