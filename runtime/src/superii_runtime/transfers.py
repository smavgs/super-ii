from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from .settings import Settings

TUS_VERSION = "1.0.0"
TUS_RESPONSE_HEADERS = {
    "cache-control",
    "location",
    "tus-checksum-algorithm",
    "tus-extension",
    "tus-max-size",
    "tus-resumable",
    "tus-version",
    "upload-complete",
    "upload-expires",
    "upload-length",
    "upload-offset",
}


@dataclass(frozen=True, slots=True)
class TransferResponse:
    status_code: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> dict[str, Any]:
        parsed = httpx.Response(self.status_code, content=self.body).json()
        if not isinstance(parsed, dict):
            raise ValueError("transfer service returned a non-object response")
        return parsed


def _target(settings: Settings, path: str) -> str:
    base = urlsplit(settings.transfer_url)
    if base.scheme != "http" or base.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("transfer service URL is not loopback-only")
    if not path.startswith("/") or path.startswith("//"):
        raise ValueError("invalid transfer service path")
    return settings.transfer_url + path


async def request_transfer(
    settings: Settings,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    content: bytes | AsyncIterator[bytes] | None = None,
    timeout_seconds: float = 1_200,
) -> TransferResponse:
    outgoing = {
        "x-superii-transfer-token": settings.require_transfer_token(),
        "accept": "application/json",
        **(headers or {}),
    }
    timeout = httpx.Timeout(timeout_seconds, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await client.request(
            method,
            _target(settings, path),
            headers=outgoing,
            content=content,
        )
        body = await response.aread()
    return TransferResponse(
        response.status_code,
        {
            name.lower(): value
            for name, value in response.headers.items()
            if name.lower() in TUS_RESPONSE_HEADERS or name.lower() == "content-type"
        },
        body,
    )


def request_transfer_sync(
    settings: Settings,
    method: str,
    path: str,
    *,
    timeout_seconds: float = 1_200,
) -> TransferResponse:
    timeout = httpx.Timeout(timeout_seconds, connect=5.0)
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        response = client.request(
            method,
            _target(settings, path),
            headers={
                "x-superii-transfer-token": settings.require_transfer_token(),
                "accept": "application/json",
            },
        )
    return TransferResponse(
        response.status_code,
        {
            name.lower(): value
            for name, value in response.headers.items()
            if name.lower() in TUS_RESPONSE_HEADERS or name.lower() == "content-type"
        },
        response.content,
    )
