import asyncio
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

from ..client import Client
from ..errors import IntegrityError, PlanError
from ..hardware import hardware
from ..model import Model
from ..planner import plan
from .contracts import Recipe, RunRecord
from .embeddings import Encoder
from .rag import RagIndex


class Project:
    def __init__(
        self, recipe: Recipe, *, directory: Path = Path("."), client: Client | None = None
    ):
        self.recipe = recipe
        self.directory = directory
        self.client = client or Client()
        self.owns_client = client is None
        self.encoder = None
        self.generator = None
        self.index = None

    def load_encoder(self):
        if self.encoder is None:
            ref = self.recipe.document["inputs"]["embedding"]
            manifest = self.recipe.inspect("embedding", self.client)
            weights = sum(
                f.size_bytes
                for f in manifest.files
                if f.path in ref["files"] and f.path.endswith(".safetensors")
            )
            if weights * 5 + 512 * 1024**2 > hardware().available_ram_bytes * 0.7:
                raise PlanError("The embedding model exceeds the CPU memory budget")
            self.encoder = Encoder(
                self.recipe.acquire("embedding", self.client),
                max_tokens=self.recipe.config["embedding_max_tokens"],
            )
        return self.encoder

    def ingest(self, documents: Path | None = None) -> Path:
        run = RunRecord(self.recipe, "ingest", directory=self.directory / "runs")
        try:
            source = documents
            if source is None:
                source = (
                    self.recipe.acquire("dataset", self.client).path
                    if self.recipe.document["inputs"]["dataset"]
                    else self.directory / "documents"
                )
            self.index, metrics = RagIndex.ingest(
                self.recipe, self.load_encoder(), source, self.directory / "index"
            )
            return run.finish(
                metrics=metrics,
                artifacts={
                    "index.json": self.directory / "index/index.json",
                    "vectors.npy": self.directory / "index/vectors.npy",
                },
            )
        except Exception as error:
            run.finish(error=type(error).__name__ + ": ingestion failed; inspect the local error")
            raise

    def load_index(self):
        if self.index is None:
            self.index = RagIndex.read(self.recipe, self.load_encoder(), self.directory / "index")
        return self.index

    def load(self):
        if self.recipe.document["outcome"] == "sft":
            raise ValueError("Run train.py for a training project")
        if self.recipe.document["inputs"]["embedding"]:
            self.load_encoder()
        if self.recipe.document["outcome"] == "rag":
            self.load_index()
        ref = self.recipe.document["inputs"]["generator"]
        manifest = self.recipe.inspect("generator", self.client)
        if manifest.manifest_sha256 != ref["manifest_sha256"]:
            raise IntegrityError("Recipe input manifest changed")
        available = replace(
            manifest,
            files=tuple(f for f in manifest.files if f.path in ref["files"]),
        )
        runtime = self.recipe.document["target"]["runtime"]
        machine = hardware()
        target = self.recipe.document["target"]["accelerator"]
        if target == "cpu":
            machine = replace(machine, accelerator="cpu", available_vram_bytes=0)
        elif target != machine.accelerator:
            raise ValueError("The selected accelerator is unavailable")
        selected = plan(
            available,
            machine,
            runtime=None if runtime == "auto" else runtime,
            context_size=self.recipe.config["context_size"],
        )
        if selected.accelerator != target:
            raise ValueError("Select a runtime and weights compatible with the target accelerator")
        snapshot = self.recipe.acquire("generator", self.client, selected_files=selected.files)
        self.generator = Model(snapshot, selected)
        return self

    def predict(self, text: str):
        if self.generator is None:
            raise RuntimeError("Load the project before inference")
        if self.index:
            return self.index.answer(text, self.generator)
        if (
            not isinstance(text, str)
            or not text
            or len(text.encode())
            > self.recipe.config["context_size"] - self.recipe.config["max_tokens"] - 128
        ):
            raise ValueError("Prompt exceeds the configured conservative context budget")
        return {
            "text": self.generator.generate(
                text, max_tokens=self.recipe.config["max_tokens"], temperature=0
            ),
            "revision": self.recipe.document["inputs"]["generator"]["revision"],
        }

    def close(self):
        if self.generator:
            self.generator.close()
        if self.index:
            self.index.close()
        self.generator = self.encoder = self.index = None
        if self.owns_client:
            self.client.close()


def create_app(
    project: Project,
    *,
    token: str,
    load_on_start: bool = True,
    allowed_hosts: tuple[str, ...] = ("localhost", "127.0.0.1", "[::1]"),
):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, Response
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Histogram,
        generate_latest,
    )
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    if len(token) < 32:
        raise ValueError("Set a random application token containing at least 32 characters")
    registry = CollectorRegistry()
    count = Counter(
        "superii_project_requests_total", "Project requests", ["route", "status"], registry=registry
    )
    duration = Histogram(
        "superii_project_request_seconds",
        "Request duration, including local inference",
        ["route"],
        registry=registry,
    )
    lock = asyncio.Lock()
    tracer = None
    provider = None
    if project.recipe.config["observability"] and os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": "superii-project"}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        tracer = provider.get_tracer("superii-project")

    @asynccontextmanager
    async def lifespan(_app):
        try:
            if load_on_start:
                await asyncio.to_thread(project.load)
            yield
        finally:
            project.close()
            if provider:
                provider.shutdown()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))

    @app.middleware("http")
    async def authentication(request: Request, call_next):
        if request.headers.get("origin"):
            return JSONResponse({"error": "Browser API requests are disabled"}, status_code=403)
        if request.url.path != "/health" and not hmac.compare_digest(
            request.headers.get("authorization", "").encode(), f"Bearer {token}".encode()
        ):
            return JSONResponse({"error": "Authentication required"}, status_code=401)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 65536:
                return JSONResponse({"error": "Request exceeds 64 KiB"}, status_code=413)
        request._body = bytes(body)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/ready")
    def ready():
        available = project.generator is not None
        return JSONResponse({"ready": available}, status_code=200 if available else 503)

    @app.get("/metrics")
    def metrics():
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    async def invoke(request: Request, route: str, operation):
        if project.generator is None:
            return JSONResponse({"error": "Project is not ready"}, status_code=503)
        if lock.locked():
            return JSONResponse({"error": "The local model is busy"}, status_code=429)
        started = time.monotonic()
        status = "200"
        try:
            data = await request.json()
            async with lock:
                if tracer:
                    with tracer.start_as_current_span(
                        route, record_exception=False, set_status_on_exception=False
                    ):
                        result = await asyncio.to_thread(operation, data)
                else:
                    result = await asyncio.to_thread(operation, data)
            return result
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            status = "422"
            return JSONResponse({"error": "Invalid input for this recipe"}, status_code=422)
        except Exception:
            status = "500"
            return JSONResponse({"error": "Local inference failed"}, status_code=500)
        finally:
            count.labels(route=route, status=status).inc()
            duration.labels(route=route).observe(time.monotonic() - started)

    @app.post("/v1/predict")
    async def predict(request: Request):
        def operation(data):
            if not isinstance(data, dict) or set(data) != {"text"}:
                raise ValueError("Supply text only")
            return project.predict(data["text"])

        return await invoke(request, "predict", operation)

    @app.post("/v1/chat/completions")
    async def chat(request: Request):
        def operation(data):
            if not isinstance(data, dict) or set(data) - {"messages", "model", "stream"}:
                raise ValueError("Use messages, optional model and stream=false")
            if data.get("stream", False) is not False:
                raise ValueError("This project returns complete responses")
            messages = data.get("messages")
            if not isinstance(messages, list) or not 1 <= len(messages) <= 32:
                raise ValueError("Use 1–32 messages")
            for message in messages:
                if not isinstance(message, dict) or set(message) != {"role", "content"}:
                    raise ValueError("Messages need role and text content")
                if message["role"] not in {"user", "assistant", "system"} or not isinstance(
                    message["content"], str
                ):
                    raise ValueError("Unsupported message")
            if sum(len(m["content"].encode()) for m in messages) + 256 >= (
                project.recipe.config["context_size"] - project.recipe.config["max_tokens"]
            ):
                raise ValueError("Messages exceed the context budget")
            sources = {}
            if project.index:
                if len(messages) != 1 or messages[0]["role"] != "user":
                    raise ValueError("This RAG template accepts one user question per request")
                result = project.predict(messages[0]["content"])
                text = result["answer"]
                sources = {"citations": result["citations"], "abstained": result["abstained"]}
            else:
                text = project.generator.chat(
                    messages, max_tokens=project.recipe.config["max_tokens"], temperature=0
                )
            return {
                "id": "chatcmpl-" + uuid4().hex,
                "object": "chat.completion",
                "created": int(time.time()),
                "model": project.recipe.document["inputs"]["generator"]["repository"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
                **sources,
            }

        return await invoke(request, "chat", operation)

    if project.recipe.document["inputs"]["embedding"]:

        @app.post("/v1/embed")
        async def embed(request: Request):
            def operation(data):
                if (
                    not isinstance(data, dict)
                    or set(data) != {"texts"}
                    or not isinstance(data["texts"], list)
                ):
                    raise ValueError("Supply a list of texts")
                return {
                    "vectors": project.encoder.encode(data["texts"]).tolist(),
                    "revision": project.recipe.document["inputs"]["embedding"]["revision"],
                }

            return await invoke(request, "embed", operation)

    return app
