from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

import superii_runtime.api as api_module
import superii_runtime.web_search as search_module
from superii_runtime.api import app
from superii_runtime.api_models import WebSearchRequest
from superii_runtime.settings import Settings, get_settings
from superii_runtime.web_search import WebSearchUnavailable, normalize_results, run_web_search


def test_search_result_normalization_is_bounded_and_safe() -> None:
    results = normalize_results(
        [
            {
                "title": "  Current   result  ",
                "href": "https://www.example.com/story?source=test#fragment",
                "body": " A useful   summary. ",
            },
            {"title": "Duplicate", "url": "https://www.example.com/story?source=test"},
            {"title": "Unsafe", "url": "javascript:alert(1)"},
        ],
        5,
    )

    assert results == [
        {
            "title": "Current result",
            "url": "https://www.example.com/story?source=test",
            "snippet": "A useful summary.",
            "source": "example.com",
        }
    ]


def test_search_endpoint_requires_runtime_auth() -> None:
    response = TestClient(app).post("/v1/search", json={"query": "today's AI news"})
    assert response.status_code == 503


def test_search_endpoint_returns_normalized_results(monkeypatch) -> None:
    token = "x" * 40
    app.dependency_overrides[get_settings] = lambda: Settings(runtime_token=token)

    async def fake_search(_payload):
        return [
            {
                "title": "Fresh result",
                "url": "https://example.com/fresh",
                "snippet": "Current information.",
                "source": "example.com",
            }
        ]

    monkeypatch.setattr(api_module, "run_web_search", fake_search)
    try:
        response = TestClient(app).post(
            "/v1/search",
            headers={"x-superii-runtime-token": token},
            json={"query": "today's AI news", "category": "news", "freshness": "day"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["results"][0]["title"] == "Fresh result"


def test_search_worker_is_secret_free_and_normalized(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeProcess:
        returncode = 0

        async def communicate(self, data: bytes):
            captured["input"] = data
            return (
                b'{"results":[{"title":" Result ","url":"https://example.com/a#x",'
                b'"snippet":" Fresh  data ","source":"Example"}]}',
                b"",
            )

    async def fake_create(*args, **kwargs):
        captured["args"] = args
        captured["env"] = kwargs["env"]
        return FakeProcess()

    monkeypatch.setenv("SUPERII_RUNTIME_TOKEN", "must-not-reach-worker")
    monkeypatch.setenv("SUPERII_DATABASE_URL", "must-not-reach-worker")
    monkeypatch.setattr(search_module, "create_subprocess_exec", fake_create)

    results = asyncio.run(run_web_search(WebSearchRequest(query="latest AI news")))

    assert "superii_runtime.web_search_worker" in captured["args"]
    assert "SUPERII_RUNTIME_TOKEN" not in captured["env"]
    assert "SUPERII_DATABASE_URL" not in captured["env"]
    assert results == [
        {
            "title": "Result",
            "url": "https://example.com/a",
            "snippet": "Fresh data",
            "source": "Example",
        }
    ]


def test_search_worker_timeout_is_killed(monkeypatch) -> None:
    class SlowProcess:
        returncode = None
        killed = False

        async def communicate(self, _data: bytes):
            await asyncio.sleep(1)
            return b"", b""

        def kill(self):
            self.killed = True

        async def wait(self):
            self.returncode = -9

    process = SlowProcess()

    async def fake_create(*_args, **_kwargs):
        return process

    monkeypatch.setattr(search_module, "create_subprocess_exec", fake_create)
    monkeypatch.setattr(search_module, "WORKER_TIMEOUT_SECONDS", 0.01)

    with pytest.raises(WebSearchUnavailable, match="timed out"):
        asyncio.run(run_web_search(WebSearchRequest(query="latest AI news")))
    assert process.killed is True
