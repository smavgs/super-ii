from pathlib import Path
from subprocess import CompletedProcess

import pytest

from superii_runtime.runtimes.llama_tokenizer import LlamaTokenizerVerifier
from superii_runtime.settings import Settings


def test_llama_tokenizer_uses_pinned_offline_cli_as_exact_id_oracle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    artifact = tmp_path / "model.gguf"
    artifact.write_bytes(b"GGUF")
    calls: list[tuple[list[str], dict]] = []
    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_tokenizer.shutil.which",
        lambda _name: "/opt/llama/llama-tokenize",
    )

    def fake_run(arguments, **kwargs):  # noqa: ANN001, ANN003, ANN202
        calls.append((arguments, kwargs))
        return CompletedProcess(arguments, 0, "[1, 7, 8]\n", "")

    monkeypatch.setattr("superii_runtime.runtimes.llama_tokenizer.subprocess.run", fake_run)
    settings = Settings(storage_root=tmp_path / "data")
    verifier = LlamaTokenizerVerifier()

    without_special = verifier.encode_ids(
        artifact,
        "a" * 64,
        "Super ii",
        add_special_tokens=False,
        settings=settings,
    )
    with_special = verifier.encode_ids(
        artifact,
        "a" * 64,
        "Super ii",
        add_special_tokens=True,
        settings=settings,
    )

    assert without_special == [1, 7, 8]
    assert with_special == [1, 7, 8]
    assert "--no-bos" in calls[0][0]
    assert "--no-bos" not in calls[1][0]
    assert calls[0][0][0] == "/opt/llama/llama-tokenize"
    assert calls[0][0][calls[0][0].index("--model") + 1] == str(artifact)
    assert {"--stdin", "--ids", "--no-escape", "--offline", "--log-disable"}.issubset(calls[0][0])
    assert calls[0][1]["input"] == "Super ii"
    assert calls[0][1]["check"] is False
    assert calls[0][1]["env"]["HF_HUB_OFFLINE"] == "1"


def test_llama_tokenizer_rejects_invalid_or_failed_cli_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    artifact = tmp_path / "model.gguf"
    artifact.write_bytes(b"GGUF")
    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_tokenizer.shutil.which",
        lambda _name: "/opt/llama/llama-tokenize",
    )
    settings = Settings(storage_root=tmp_path / "data")
    verifier = LlamaTokenizerVerifier()

    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_tokenizer.subprocess.run",
        lambda *_args, **_kwargs: CompletedProcess([], 0, "not-json", ""),
    )
    with pytest.raises(RuntimeError, match="invalid tokenizer output"):
        verifier.encode_ids(
            artifact,
            "a" * 64,
            "text",
            add_special_tokens=False,
            settings=settings,
        )

    monkeypatch.setattr(
        "superii_runtime.runtimes.llama_tokenizer.subprocess.run",
        lambda *_args, **_kwargs: CompletedProcess([], 1, "", "private diagnostic"),
    )
    with pytest.raises(RuntimeError, match="verification failed") as caught:
        verifier.encode_ids(
            artifact,
            "a" * 64,
            "text",
            add_special_tokens=False,
            settings=settings,
        )
    assert "private diagnostic" not in str(caught.value)
