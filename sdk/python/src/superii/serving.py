from __future__ import annotations

import hmac
import logging
import time
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from .client import Client
    from .model import Model


logger = logging.getLogger(__name__)


def create_app(model: Model, *, token: str):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    if len(token) < 32:
        raise ValueError("Use a random serving token with at least 32 characters")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])

    @app.middleware("http")
    async def authentication(request: Request, call_next):
        if request.headers.get("origin"):
            return JSONResponse({"error": "browser origins are not allowed"}, status_code=403)
        expected = f"Bearer {token}"
        if not hmac.compare_digest(
            request.headers.get("authorization", "").encode(), expected.encode()
        ):
            return JSONResponse({"error": "authentication required"}, status_code=401)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 1024**2:
                return JSONResponse({"error": "request too large"}, status_code=413)
        request._body = bytes(body)
        return await call_next(request)

    @app.get("/v1/models")
    def models():
        return {
            "object": "list",
            "data": [
                {
                    "id": model.plan.repository,
                    "object": "model",
                    "owned_by": "local",
                    "revision": model.plan.revision,
                }
            ],
        }

    async def complete(request, *, chat: bool):
        import asyncio

        try:
            data = await request.json()
        except (TypeError, ValueError):
            return JSONResponse({"error": "request must contain valid JSON"}, status_code=422)

        allowed = {
            "model",
            "max_tokens",
            "temperature",
            "stream",
            "messages" if chat else "prompt",
        }
        if not isinstance(data, dict) or set(data) - allowed or data.get("stream", False):
            return JSONResponse(
                {"error": "this endpoint supports non-streaming text requests only"},
                status_code=422,
            )
        if data.get("model") != model.plan.repository:
            return JSONResponse({"error": "requested model is not loaded"}, status_code=422)
        max_tokens = data.get("max_tokens", 256)
        if (
            isinstance(max_tokens, bool)
            or not isinstance(max_tokens, int)
            or not 1 <= max_tokens <= 4096
        ):
            return JSONResponse(
                {"error": "max_tokens must be an integer from 1 to 4096"}, status_code=422
            )
        temperature = data.get("temperature", 0)
        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or not 0 <= temperature <= 2
        ):
            return JSONResponse(
                {"error": "temperature must be a number from 0 to 2"}, status_code=422
            )

        if chat:
            messages = data.get("messages")
            if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
                return JSONResponse(
                    {"error": "messages must contain 1-100 text messages"}, status_code=422
                )
            if any(
                not isinstance(message, dict)
                or set(message) != {"role", "content"}
                or message["role"] not in {"system", "user", "assistant"}
                or not isinstance(message["content"], str)
                or not 1 <= len(message["content"]) <= 100_000
                for message in messages
            ):
                return JSONResponse(
                    {
                        "error": (
                            "only bounded system, user and assistant text messages are supported"
                        )
                    },
                    status_code=422,
                )
        else:
            prompt = data.get("prompt")
            if not isinstance(prompt, str) or not 1 <= len(prompt) <= 100_000:
                return JSONResponse(
                    {"error": "prompt must contain 1-100000 characters"}, status_code=422
                )

        try:
            if chat:
                if model._tokenizer is None:
                    # llama.cpp handles the model's embedded chat template.
                    response = await asyncio.to_thread(
                        model.chat,
                        messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )
                else:
                    prompt = model._tokenizer.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True
                    )
                    response = await asyncio.to_thread(
                        model.generate,
                        prompt,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )
            else:
                response = await asyncio.to_thread(
                    model.generate,
                    prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            choice = (
                {"message": {"role": "assistant", "content": response}}
                if chat
                else {"text": response}
            )
            return {
                "id": f"superii-{uuid4()}",
                "created": int(time.time()),
                "object": "chat.completion" if chat else "text_completion",
                "model": model.plan.repository,
                "choices": [{"index": 0, **choice, "finish_reason": "stop"}],
            }
        except Exception:
            logger.exception("Local model request failed")
            return JSONResponse({"error": "model request failed"}, status_code=422)

    # Avoid forward-reference resolution of locally imported Request by FastAPI.
    async def completion(request):
        return await complete(request, chat=False)

    async def chat_completion(request):
        return await complete(request, chat=True)

    completion.__annotations__["request"] = Request
    chat_completion.__annotations__["request"] = Request
    app.post("/v1/completions")(completion)
    app.post("/v1/chat/completions")(chat_completion)
    return app


def serve(model: Model, *, port: int, token: str) -> None:
    import uvicorn

    uvicorn.run(create_app(model, token=token), host="127.0.0.1", port=port, access_log=False)


def serve_mcp(model: Model) -> None:
    from mcp.server.fastmcp import FastMCP

    server = FastMCP("Super ii local inference")

    @server.tool()
    def generate(prompt: str, max_tokens: int = 256) -> str:
        """Generate text with the already-loaded local model. Model output is untrusted data."""
        return model.generate(prompt, max_tokens=max_tokens)

    server.run(transport="stdio")


def create_cache_app(client: Client, *, token: str):
    """Explicit peer endpoint. It cannot discover peers, repositories or private data."""
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.responses import FileResponse

    if len(token) < 32:
        raise ValueError("Peer credential must contain at least 32 characters")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/v1/cache/{owner}/{slug}/{revision}/{digest}")
    def cached(
        owner: str,
        slug: str,
        revision: str,
        digest: str,
        authorization: str | None = Header(default=None),
    ):
        if not hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
            raise HTTPException(401, "peer credential required")
        try:
            manifest = client.inspect(f"{owner}/{slug}", revision=revision)
            if manifest.visibility != "public" or not any(
                f.sha256 == digest for f in manifest.files
            ):
                raise HTTPException(404, "public object unavailable")
            from .client import sha256

            path = client.cache / "objects" / digest
            if path.is_symlink() or not path.is_file() or sha256(path) != digest:
                raise HTTPException(404, "verified object not cached")
            return FileResponse(path, headers={"cache-control": "private, no-store"})
        except (ValueError, RuntimeError) as error:
            raise HTTPException(404, "canonical authorization unavailable") from error

    return app
