from __future__ import annotations

import json
import os
import sys
from asyncio import create_subprocess_exec, subprocess, wait_for
from collections.abc import Iterable, Mapping
from contextlib import suppress
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .api_models import WebSearchRequest

FRESHNESS = {
    "any": None,
    "day": "d",
    "week": "w",
    "month": "m",
    "year": "y",
}
WORKER_TIMEOUT_SECONDS = 12
MAX_WORKER_OUTPUT_BYTES = 64_000


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
    # Import only inside the isolated worker. Some native HTTP backends can hold
    # the GIL while waiting, so they must never run inside the API process.
    from ddgs import DDGS

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
    environment = {
        name: os.environ[name]
        for name in ("PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR")
        if name in os.environ
    }
    environment["PYTHONUTF8"] = "1"
    process = None
    try:
        process = await create_subprocess_exec(  # noqa: S603
            sys.executable,
            "-m",
            "superii_runtime.web_search_worker",
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        stdout, _ = await wait_for(
            process.communicate(payload.model_dump_json().encode()),
            timeout=WORKER_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        if process is not None:
            with suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        raise WebSearchUnavailable("search worker timed out") from error
    except (OSError, ValueError) as error:
        raise WebSearchUnavailable("search worker unavailable") from error

    if process is None:
        raise WebSearchUnavailable("search worker unavailable")
    if process.returncode != 0 or len(stdout) > MAX_WORKER_OUTPUT_BYTES:
        raise WebSearchUnavailable("search worker failed")
    try:
        response = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise WebSearchUnavailable("search worker returned invalid data") from error
    if not isinstance(response, dict) or not isinstance(response.get("results"), list):
        raise WebSearchUnavailable("search worker returned invalid data")
    values = [item for item in response["results"] if isinstance(item, dict)]
    return normalize_results(values, payload.max_results)
