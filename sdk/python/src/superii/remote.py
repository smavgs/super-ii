"""Explicit remote warm-start adapter; never an automatic local fallback."""

from __future__ import annotations

import httpx

from .errors import SuperiiError
from .manifest import origin


class RemoteModel:
    """Calling generate sends that prompt to the explicitly chosen remote provider.

    The provider's token is required explicitly; SUPERII_TOKEN is never reused.
    Local acquisition can run concurrently via apull or an application executor.
    Applications choose the handoff between requests, without mixing providers
    inside a response. This does not prove remote and local models are identical.
    """

    def __init__(
        self, base_url: str, model: str, *, token: str, transport: httpx.BaseTransport | None = None
    ):
        parsed_origin = origin(base_url)
        if base_url.rstrip("/") != parsed_origin or not token or not model:
            raise ValueError("Provide a provider origin, model ID and separate provider token")
        self.base_url, self.model = base_url.rstrip("/"), model
        self._http = httpx.Client(
            headers={"authorization": f"Bearer {token}"},
            timeout=120,
            trust_env=False,
            follow_redirects=False,
            transport=transport,
        )

    def generate(self, prompt: str, *, max_tokens: int = 128) -> str:
        if not isinstance(prompt, str) or len(prompt.encode()) > 1024**2:
            raise ValueError("Prompt must be text up to 1 MiB")
        if not 1 <= max_tokens <= 8192:
            raise ValueError("max_tokens must be 1–8192")
        try:
            with self._http.stream(
                "POST",
                self.base_url + "/v1/completions",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
            ) as response:
                if response.status_code != 200:
                    raise SuperiiError(f"Remote provider returned HTTP {response.status_code}")
                body = bytearray()
                for part in response.iter_bytes(chunk_size=64 * 1024):
                    body.extend(part)
                    if len(body) > 16 * 1024**2:
                        raise SuperiiError("Remote response exceeds 16 MiB")
                import json

                value = json.loads(body)["choices"][0]["text"]
                if not isinstance(value, str):
                    raise ValueError("Non-text response")
                return value
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as error:
            raise SuperiiError(
                "Remote generation failed; no automatic provider fallback"
            ) from error

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> RemoteModel:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
