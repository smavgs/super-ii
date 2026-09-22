from pathlib import Path

from superii_runtime.runtimes.llama_tokenizer import LlamaTokenizerPool
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

    def __init__(self, payload) -> None:  # noqa: ANN001
        self.payload = payload

    def json(self):  # noqa: ANN201
        return self.payload


class FakeClient:
    calls: list[tuple[str, dict]] = []

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *_args) -> None:  # noqa: ANN002
        pass

    def post(self, path, json):  # noqa: ANN001, ANN201
        self.calls.append((path, json))
        if path.endswith("/tokenize"):
            if json["content"] == "ready":
                return FakeResponse({"tokens": [{"id": 1, "piece": "ready"}]})
            return FakeResponse(
                {
                    "tokens": [
                        {"id": 1, "piece": "<s>"},
                        {"id": 7, "piece": [240, 159, 164, 150]},
                        {"id": 8, "piece": " hi"},
                    ]
                }
            )
        ids = json["tokens"]
        return FakeResponse(
            {"content": "".join({1: "<s>", 7: "🤖", 8: " hi"}[item] for item in ids)}
        )

    def close(self) -> None:
        pass


def test_llama_tokenizer_uses_vocab_only_loopback_and_exact_special_ids(
    tmp_path: Path, monkeypatch
) -> None:
    artifact = tmp_path / "tokenizer.gguf"
    artifact.write_bytes(b"GGUF")
    command: list[str] = []
    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_tokenizer.shutil.which", lambda _name: "/bin/llama-server"
    )
    monkeypatch.setattr("superii_runtime.runtimes.llama_tokenizer.httpx.Client", FakeClient)

    def fake_popen(arguments, **_kwargs):  # noqa: ANN001, ANN003, ANN202
        command.extend(arguments)
        return FakeProcess()

    monkeypatch.setattr("superii_runtime.runtimes.llama_tokenizer.subprocess.Popen", fake_popen)
    settings = Settings(
        storage_root=tmp_path / "data",
        llama_server_start_timeout_seconds=10,
    )
    pool = LlamaTokenizerPool()
    encoded = pool.encode(
        artifact,
        "a" * 64,
        "🤖 hi",
        add_special_tokens=True,
        special_token_ids={1},
        settings=settings,
    )
    decoded = pool.decode(
        artifact,
        "a" * 64,
        encoded["token_ids"],
        skip_special_tokens=True,
        special_token_ids={1},
        settings=settings,
    )

    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert "--vocab-only" in command and "--offline" in command and "--no-webui" in command
    assert encoded["pieces"][0]["special"] is True
    assert encoded["pieces"][0]["byte_start"] == 0
    assert encoded["pieces"][0]["byte_end"] == 0
    assert encoded["pieces"][1]["piece_bytes"] == [240, 159, 164, 150]
    assert encoded["pieces"][1]["byte_end"] == len("🤖".encode())
    assert encoded["pieces"][2]["byte_end"] == len("🤖 hi".encode())
    assert encoded["offsets_verified"] is True
    assert decoded["text"] == "🤖 hi"
    assert decoded["skip_special_tokens_applied"] is True
    pool.close()


def test_llama_tokenizer_does_not_invent_offsets_for_normalized_pieces() -> None:
    pieces, verified = LlamaTokenizerPool._pieces(
        ["normalized"],
        [7],
        set(),
        "original",
    )

    assert verified is False
    assert pieces[0]["byte_start"] is None
    assert pieces[0]["character_end"] is None
