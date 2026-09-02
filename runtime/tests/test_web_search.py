from __future__ import annotations

from fastapi.testclient import TestClient

import superii_runtime.api as api_module
from superii_runtime.api import app
from superii_runtime.settings import Settings, get_settings
from superii_runtime.web_search import normalize_results


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
