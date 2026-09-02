from __future__ import annotations

from asyncio import to_thread
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from ddgs import DDGS

from .api_models import WebSearchRequest

FRESHNESS = {
    "any": None,
    "day": "d",
    "week": "w",
    "month": "m",
    "year": "y",
}


class WebSearchUnavailable(RuntimeError):
    """Raised when the private search adapter cannot return safe results."""


def _clean_text(value: object, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:max_length]


def _clean_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


def normalize_results(
    values: Iterable[Mapping[str, Any]],
    limit: int,
) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in values:
        url = _clean_url(item.get("href") or item.get("url"))
        title = _clean_text(item.get("title"), 240)
        if not url or not title or url in seen:
            continue
        seen.add(url)
        parsed = urlsplit(url)
        source = _clean_text(item.get("source"), 120) or (parsed.hostname or "").removeprefix(
            "www."
        )
        result = {
            "title": title,
            "url": url,
            "snippet": _clean_text(item.get("body") or item.get("snippet"), 600),
            "source": source,
        }
        date = _clean_text(item.get("date"), 80)
        if date:
            result["date"] = date
        results.append(result)
        if len(results) >= limit:
            break
    return results


def _search_sync(payload: WebSearchRequest) -> list[dict[str, str]]:
    client = DDGS(timeout=8)
    try:
        method = client.news if payload.category == "news" else client.text
        raw = method(
            payload.query,
            region="wt-wt",
            safesearch=payload.safe_search,
            timelimit=FRESHNESS[payload.freshness],
            max_results=payload.max_results,
        )
        return normalize_results(raw, payload.max_results)
    except Exception as error:
        raise WebSearchUnavailable("search provider unavailable") from error
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


async def run_web_search(payload: WebSearchRequest) -> list[dict[str, str]]:
    return await to_thread(_search_sync, payload)
