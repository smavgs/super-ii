from fastapi.testclient import TestClient

from superii_runtime.api import app
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
