import json
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import superii_runtime.api as api_module
from superii_runtime.api import _tokenizer_pack_manifest, app, inspect_revision
from superii_runtime.api_models import DetokenizeRequest, InspectRevisionRequest
from superii_runtime.capabilities import capability_report
from superii_runtime.settings import Settings


def test_health_does_not_require_secrets() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "service": "superii-runtime",
        "status": "ok",
        "version": "0.1.0",
    }


def test_capabilities_fail_closed_without_runtime_token() -> None:
    response = TestClient(app).get("/v1/capabilities")
    assert response.status_code == 503


def test_notebook_capability_reports_isolated_execution_boundary() -> None:
    notebook = capability_report(Settings())["notebooks"]
    assert notebook["available"] is True
    assert isinstance(notebook["code_execution"], bool)
    assert notebook["active_outputs"] is True
    assert notebook["network"] == "disabled"
    assert notebook["secrets_injected"] is False


@pytest.mark.parametrize("invalid", [[1.0], [True], [-1], [2**31]])
def test_detokenize_request_rejects_noncanonical_token_ids(invalid) -> None:
    with pytest.raises(ValidationError):
        DetokenizeRequest(token_ids=invalid)


def test_tokenizer_pack_disk_rebuild_must_match_published_hash(monkeypatch, tmp_path) -> None:
    repository_id = uuid4()
    revision_id = uuid4()
    recorded_hash = "a" * 64

    class Database:
        def get_revision_analysis(self, *_args):
            return {
                "status": "passed",
                "result": {
                    "applicable": True,
                    "manifest": {
                        "pack_sha256": recorded_hash,
                        "artifacts": [{"path": "tokenizer.json"}],
                    },
                },
            }

        def list_revision_files(self, _revision_id):
            return []

        def save_revision_analysis(self, *_args):
            raise AssertionError("published tokenizer evidence must not be overwritten")

    class WorkspaceCache:
        def materialize(self, *_args):
            return tmp_path

    class TokenizerStore:
        def artifact(self, *_args):
            raise FileNotFoundError("runtime disk was replaced")

        def build(self, **_kwargs):
            return {"pack_sha256": "b" * 64}

    monkeypatch.setattr(api_module, "get_workspace_cache", lambda: WorkspaceCache())
    monkeypatch.setattr(api_module, "get_tokenizer_pack_store", lambda: TokenizerStore())

    with pytest.raises(RuntimeError, match="immutable published record"):
        _tokenizer_pack_manifest(Database(), repository_id, revision_id)


def test_model_inspection_fails_closed_without_returning_tokenizer_exception_details(
    monkeypatch, tmp_path
) -> None:
    canary = "postgresql://owner:do-not-return@example.invalid/private"
    repository_id = uuid4()
    revision_id = uuid4()
    model = tmp_path / "model.gguf"
    model.write_bytes(b"fixture")

    class Database:
        def __init__(self) -> None:
            self.saved = []

        def list_revision_files(self, _revision_id):
            return [
                SimpleNamespace(
                    repository_id=repository_id,
                    path="model.gguf",
                    size_bytes=model.stat().st_size,
                )
            ]

        def save_revision_analysis(self, *args):
            self.saved.append(args)

    @contextmanager
    def materialized(*_args, **_kwargs):
        yield tmp_path

    class TokenizerStore:
        def build(self, **_kwargs):
            raise ValueError(canary)

    database = Database()
    monkeypatch.setattr(api_module, "materialized_revision", materialized)
    monkeypatch.setattr(api_module, "get_store", lambda: object())
    monkeypatch.setattr(api_module, "inspect_gguf", lambda _path: {"format": "gguf"})
    monkeypatch.setattr(api_module, "get_tokenizer_pack_store", lambda: TokenizerStore())
    monkeypatch.setattr(api_module, "derive_model_compatibility", lambda *_args: {})

    with pytest.raises(HTTPException) as raised:
        inspect_revision(
            repository_id,
            revision_id,
            InspectRevisionRequest(kind="model"),
            object(),
            database,
        )

    assert raised.value.status_code == 422
    assert raised.value.detail == "offline inspection failed"
    assert canary not in str(raised.value)
    tokenizer = next(item for item in database.saved if item[2] == "tokenizer")
    assert tokenizer[3] == "failed"
    assert canary not in json.dumps(tokenizer, default=str)
