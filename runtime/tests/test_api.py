import json
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

import superii_runtime.api as api_module
from superii_runtime.api import app, inspect_revision
from superii_runtime.api_models import InspectRevisionRequest
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


def test_model_inspection_never_returns_tokenizer_exception_details(monkeypatch, tmp_path) -> None:
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

    def tokenizer_failure(_workspace):
        raise ValueError(canary)

    database = Database()
    monkeypatch.setattr(api_module, "materialized_revision", materialized)
    monkeypatch.setattr(api_module, "get_store", lambda: object())
    monkeypatch.setattr(api_module, "inspect_gguf", lambda _path: {"format": "gguf"})
    monkeypatch.setattr(api_module, "inspect_tokenizer", tokenizer_failure)
    monkeypatch.setattr(api_module, "derive_model_compatibility", lambda *_args: {})

    response = inspect_revision(
        repository_id,
        revision_id,
        InspectRevisionRequest(kind="model"),
        object(),
        database,
    )

    assert response["analysis"]["tokenizer"] == {
        "available": False,
        "reason": "tokenizer inspection unavailable",
    }
    assert canary not in json.dumps(response)
    assert database.saved[-1][3] == "passed"
