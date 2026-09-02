from __future__ import annotations

import importlib.metadata
import json
from asyncio import to_thread
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

from .api_models import (
    CreateRevisionRequest,
    CreateTransferRequest,
    DiffusionGenerateRequest,
    ExecuteNotebookRequest,
    InspectRevisionRequest,
    LlamaChatRequest,
    LlamaGenerateRequest,
    TokenizeRequest,
    WebSearchRequest,
)
from .artifacts import ArtifactStore
from .capabilities import capability_report
from .database import RepositoryDatabase
from .inspectors import (
    inspect_dataset,
    inspect_diffusers,
    inspect_model,
    inspect_notebooks,
    inspect_tokenizer,
    tokenize_text,
)
from .inspectors.compatibility import derive_model_compatibility
from .inspectors.gguf import inspect_gguf
from .notebooks import NotebookRunner
from .pipeline import UploadHeld, UploadRejected, process_completed_transfer, process_upload
from .scanners import scanner_readiness
from .security import RuntimeAuth
from .settings import Settings, get_settings
from .spaces import SpaceRunner
from .storage import ObjectStore, StorageError, normalize_repository_path
from .transfers import (
    TUS_RESPONSE_HEADERS,
    TUS_VERSION,
    TransferResponse,
    request_transfer,
    request_transfer_sync,
)
from .web_search import WebSearchUnavailable, run_web_search
from .workspace_cache import PersistentWorkspaceCache
from .workspaces import materialized_revision, revision_manifest, revision_manifest_document

app = FastAPI(
    title="Super ii Runtime",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

SPACE_PROXY_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
SPACE_REQUEST_HEADERS = {
    "accept",
    "accept-encoding",
    "content-type",
    "if-modified-since",
    "if-none-match",
    "last-event-id",
    "range",
}
SPACE_RESPONSE_HEADERS = {
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "content-encoding",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
    "location",
}
INLINE_MEDIA_TYPES = {
    "application/pdf",
    "audio/aac",
    "audio/flac",
    "audio/m4a",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/ogg",
    "video/webm",
}


@lru_cache
def get_store() -> ObjectStore:
    settings = get_settings()
    return ObjectStore(settings.storage_root, settings.max_upload_bytes)


@lru_cache
def get_artifact_store() -> ArtifactStore:
    settings = get_settings()
    return ArtifactStore(settings.storage_root, settings.artifact_retention_seconds)


@lru_cache
def get_workspace_cache() -> PersistentWorkspaceCache:
    return PersistentWorkspaceCache(get_store())


@lru_cache
def get_llama_pool():
    from .runtimes.llama_server import LlamaServerPool

    return LlamaServerPool()


@lru_cache
def get_notebook_runner() -> NotebookRunner:
    return NotebookRunner(get_settings(), get_store())


def get_database(settings: Settings = Depends(get_settings)) -> RepositoryDatabase:
    try:
        return RepositoryDatabase(settings)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="runtime database is not configured",
        ) from error


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _require_public_revision(
    database: RepositoryDatabase,
    repository_id: UUID,
    revision_id: UUID,
) -> None:
    if not database.revision_is_public(repository_id, revision_id):
        raise HTTPException(status_code=404, detail="published revision not found")
    files = database.list_revision_files(revision_id)
    if not files or any(file.repository_id != repository_id for file in files):
        raise HTTPException(status_code=404, detail="published revision not found")


def _transfer_response(upstream: TransferResponse) -> Response:
    headers = {
        name: value for name, value in upstream.headers.items() if name in TUS_RESPONSE_HEADERS
    }
    content_type = upstream.headers.get("content-type")
    if content_type:
        headers["content-type"] = content_type
    return Response(content=upstream.body, status_code=upstream.status_code, headers=headers)


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "superii-runtime", "status": "ok", "version": "0.1.0"}


@app.post("/v1/search")
async def web_search(payload: WebSearchRequest, _auth: RuntimeAuth) -> dict[str, object]:
    try:
        results = await run_web_search(payload)
    except WebSearchUnavailable as error:
        raise HTTPException(status_code=503, detail="web search is unavailable") from error
    return {"query": payload.query, "results": results}


@app.options("/v1/transfers")
async def transfer_options(
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    try:
        return _transfer_response(await request_transfer(settings, "OPTIONS", "/v1/transfers"))
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error


@app.post("/v1/transfers", status_code=status.HTTP_201_CREATED)
async def create_transfer(
    payload: CreateTransferRequest,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    body = json.dumps(payload.model_dump(mode="json"), separators=(",", ":")).encode()
    try:
        upstream = await request_transfer(
            settings,
            "POST",
            "/v1/transfers",
            headers={"content-type": "application/json", "tus-resumable": TUS_VERSION},
            content=body,
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error
    return _transfer_response(upstream)


@app.head("/v1/transfers/{transfer_id}")
async def head_transfer(
    transfer_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    try:
        upstream = await request_transfer(
            settings,
            "HEAD",
            f"/v1/transfers/{transfer_id}",
            headers={"tus-resumable": TUS_VERSION},
            timeout_seconds=30,
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error
    return _transfer_response(upstream)


@app.get("/v1/transfers/{transfer_id}")
async def get_transfer(
    transfer_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    try:
        upstream = await request_transfer(
            settings, "GET", f"/v1/transfers/{transfer_id}", timeout_seconds=30
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error
    return _transfer_response(upstream)


@app.patch("/v1/transfers/{transfer_id}")
async def patch_transfer(
    transfer_id: UUID,
    request: Request,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    content_length = request.headers.get("content-length") or request.headers.get(
        "x-superii-chunk-length"
    )
    if (
        request.headers.get("tus-resumable") != TUS_VERSION
        or request.headers.get("content-type") != "application/offset+octet-stream"
        or content_length is None
        or not content_length.isdigit()
        or int(content_length) < 1
        or int(content_length) > settings.transfer_max_chunk_bytes
    ):
        raise HTTPException(status_code=400, detail="invalid bounded TUS chunk")
    headers = {
        "content-length": content_length,
        "content-type": "application/offset+octet-stream",
        "tus-resumable": TUS_VERSION,
        "upload-offset": request.headers.get("upload-offset", ""),
        "upload-checksum": request.headers.get("upload-checksum", ""),
    }
    try:
        upstream = await request_transfer(
            settings,
            "PATCH",
            f"/v1/transfers/{transfer_id}",
            headers=headers,
            content=request.stream(),
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error
    return _transfer_response(upstream)


@app.delete("/v1/transfers/{transfer_id}")
async def delete_transfer(
    transfer_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> Response:
    try:
        upstream = await request_transfer(
            settings,
            "DELETE",
            f"/v1/transfers/{transfer_id}",
            headers={"tus-resumable": TUS_VERSION},
            timeout_seconds=30,
        )
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="transfer service is unavailable") from error
    return _transfer_response(upstream)


@app.post("/v1/transfers/{transfer_id}/commit")
async def commit_transfer(
    transfer_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    try:
        upstream = await request_transfer(
            settings, "GET", f"/v1/transfers/{transfer_id}", timeout_seconds=30
        )
        if upstream.status_code >= 300:
            raise HTTPException(status_code=upstream.status_code, detail="transfer is unavailable")
        record = upstream.json()
        return await to_thread(
            process_completed_transfer,
            record=record,
            settings=settings,
            database=database,
        )
    except UploadRejected as error:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "upload_rejected",
                "failed_gates": [
                    result.scanner for result in error.results if result.status == "failed"
                ],
            },
        ) from error
    except UploadHeld as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "upload_quarantined",
                "errored_gates": [
                    result.scanner for result in error.results if result.status == "error"
                ],
            },
        ) from error
    except HTTPException:
        raise
    except (httpx.HTTPError, RuntimeError, ValueError, OSError) as error:
        raise HTTPException(
            status_code=503, detail="transfer commit could not be completed"
        ) from error


@app.get("/ready")
def ready(
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    scanners = scanner_readiness(settings)
    try:
        database = RepositoryDatabase(settings)
        database_ready = database.ping()
    except RuntimeError:
        database_ready = False
    store = get_store()
    storage_ready = store.root.is_dir() and store.root.exists()
    try:
        transfer_ready = (
            request_transfer_sync(settings, "GET", "/health", timeout_seconds=3).status_code == 200
        )
    except (httpx.HTTPError, RuntimeError, ValueError):
        transfer_ready = False
    ready_state = database_ready and storage_ready and transfer_ready and all(scanners.values())
    return {
        "status": "ready" if ready_state else "blocked",
        "database": database_ready,
        "storage": storage_ready,
        "transfer_service": transfer_ready,
        "required_scanners": scanners,
        "publishing_enabled": ready_state,
    }


@app.get("/v1/capabilities")
def capabilities(
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return capability_report(settings)


@app.post("/v1/repositories/{repository_id}/revisions", status_code=status.HTTP_201_CREATED)
def create_revision(
    repository_id: UUID,
    payload: CreateRevisionRequest,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    try:
        row = database.create_revision(
            repository_id,
            payload.parent_revision_id,
            payload.message,
            payload.created_by,
        )
    except Exception as error:
        raise HTTPException(status_code=409, detail="revision could not be created") from error
    return {key: str(value) if isinstance(value, UUID) else value for key, value in row.items()}


@app.post(
    "/v1/repositories/{repository_id}/revisions/{revision_id}/files",
    status_code=status.HTTP_201_CREATED,
)
def upload_file(
    repository_id: UUID,
    revision_id: UUID,
    path: Annotated[str, Form(min_length=1, max_length=1024)],
    created_by: Annotated[str, Form(min_length=1, max_length=255)],
    upload: Annotated[UploadFile, File()],
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    try:
        return process_upload(
            source=upload.file,
            repository_path=path,
            mime_type=upload.content_type,
            repository_id=repository_id,
            revision_id=revision_id,
            created_by=created_by,
            settings=settings,
            database=database,
            store=get_store(),
        )
    except StorageError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except UploadRejected as error:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "upload_rejected",
                "failed_gates": [
                    result.scanner for result in error.results if result.status == "failed"
                ],
            },
        ) from error
    except UploadHeld as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "upload_quarantined",
                "errored_gates": [
                    result.scanner for result in error.results if result.status == "error"
                ],
            },
        ) from error


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/finalize")
def finalize_revision(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    if not database.revision_is_ready_for_review(revision_id):
        raise HTTPException(status_code=409, detail="revision contains pending or rejected files")
    if not database.revision_analysis_passed(repository_id, revision_id):
        raise HTTPException(
            status_code=409, detail="applicable offline repository analysis has not passed"
        )
    files = database.list_revision_files(revision_id)
    if any(file.repository_id != repository_id for file in files):
        raise HTTPException(status_code=404, detail="revision not found")
    manifest_sha256 = revision_manifest(files)
    manifest = revision_manifest_document(files)
    commit_sha = database.update_revision_manifest(
        revision_id,
        manifest_sha256,
        len(files),
        sum(file.size_bytes for file in files),
        manifest,
    )
    database.set_revision_status(revision_id, "review")
    return {
        "repository_id": str(repository_id),
        "revision_id": str(revision_id),
        "status": "review",
        "manifest_sha256": manifest_sha256,
        "commit_sha": commit_sha,
        "manifest": manifest,
        "file_count": len(files),
        "total_size_bytes": sum(file.size_bytes for file in files),
    }


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/inspect")
def inspect_revision(
    repository_id: UUID,
    revision_id: UUID,
    payload: InspectRevisionRequest,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    files = database.list_revision_files(revision_id)
    if not files or any(file.repository_id != repository_id for file in files):
        raise HTTPException(status_code=404, detail="revision not found")

    has_notebooks = any(file.path.lower().endswith(".ipynb") for file in files)
    notebook_result: dict[str, Any] | None = None
    try:
        with materialized_revision(database, get_store(), revision_id) as workspace:
            if has_notebooks:
                try:
                    notebook_result = inspect_notebooks(workspace)
                except (OSError, ValueError, RuntimeError) as error:
                    database.save_revision_analysis(
                        repository_id,
                        revision_id,
                        "notebook",
                        "failed",
                        {
                            "error": str(error)[:1000],
                            "static_only": True,
                            "code_executed": False,
                        },
                        {"nbformat": _package_version("nbformat")},
                    )
                    raise
                database.save_revision_analysis(
                    repository_id,
                    revision_id,
                    "notebook",
                    "passed",
                    notebook_result,
                    {
                        "nbformat": _package_version("nbformat"),
                        "superii_notebook_contract": "1",
                    },
                )
            if payload.kind == "model":
                result = {"model": None, "gguf": [], "safetensors": []}
                if (workspace / "config.json").is_file():
                    result["model"] = inspect_model(workspace)
                for gguf_file in sorted(workspace.rglob("*.gguf")):
                    result["gguf"].append(
                        {
                            "path": gguf_file.relative_to(workspace).as_posix(),
                            "inspection": inspect_gguf(gguf_file),
                        }
                    )
                for tensor_file in sorted(workspace.rglob("*.safetensors")):
                    from .inspectors.safetensors import inspect_safetensors

                    result["safetensors"].append(
                        {
                            "path": tensor_file.relative_to(workspace).as_posix(),
                            "inspection": inspect_safetensors(tensor_file),
                        }
                    )
                try:
                    result["tokenizer"] = inspect_tokenizer(workspace)
                except (OSError, ValueError, KeyError) as error:
                    result["tokenizer"] = {"available": False, "reason": str(error)[:500]}
                if (workspace / "model_index.json").is_file():
                    result["diffusers"] = inspect_diffusers(workspace)
                if result["model"] is None and not result["gguf"] and not result["safetensors"]:
                    raise ValueError("no supported local model files were found")
                result["compatibility"] = derive_model_compatibility(workspace, result, files)
            elif payload.kind == "dataset":
                result = {"dataset": inspect_dataset(workspace)}
            else:
                app_file = workspace / "app.py"
                result = {
                    "space": {
                        "framework": "gradio" if app_file.exists() else None,
                        "entrypoint": "app.py" if app_file.exists() else None,
                        "runnable": app_file.exists(),
                    }
                }
            if notebook_result is not None:
                result["notebooks"] = {
                    "count": notebook_result["notebook_count"],
                    "static_only": True,
                    "code_executed": False,
                }
    except (OSError, ValueError, RuntimeError) as error:
        database.save_revision_analysis(
            repository_id,
            revision_id,
            payload.kind,
            "failed",
            {"error": str(error)[:1000]},
            {},
        )
        raise HTTPException(status_code=422, detail="offline inspection failed") from error

    versions = {
        "datasets": _package_version("datasets"),
        "safetensors": _package_version("safetensors"),
        "tokenizers": _package_version("tokenizers"),
        "transformers": _package_version("transformers"),
        "nbformat": _package_version("nbformat"),
        "superii_compatibility": "1",
    }
    database.save_revision_analysis(
        repository_id,
        revision_id,
        payload.kind,
        "passed",
        result,
        versions,
    )
    return {"status": "passed", "analysis": result, "tool_versions": versions}


def _model_file(workspace: Path, requested: str | None, suffix: str) -> Path:
    if requested:
        safe_path = normalize_repository_path(requested)
        candidate = (workspace / Path(*safe_path.split("/"))).resolve()
        if not candidate.is_relative_to(workspace) or not candidate.is_file():
            raise ValueError("requested model file does not exist")
        if candidate.suffix.lower() != suffix:
            raise ValueError(f"requested model must use {suffix}")
        return candidate
    matches = sorted(workspace.rglob(f"*{suffix}"))
    if len(matches) != 1:
        raise ValueError(f"select one {suffix} model file")
    return matches[0]


def _model_identity(
    database: RepositoryDatabase,
    revision_id: UUID,
    workspace: Path,
    model: Path,
) -> tuple[str, str]:
    model_path = model.relative_to(workspace).as_posix()
    for file in database.list_revision_files(revision_id):
        if file.path == model_path:
            return model_path, file.sha256
    raise ValueError("model is not part of the verified revision")


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/llama/generate")
def llama_generate(
    repository_id: UUID,
    revision_id: UUID,
    payload: LlamaGenerateRequest,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        workspace = get_workspace_cache().materialize(database, revision_id)
        model = _model_file(workspace, payload.model_path, ".gguf")
        model_path, model_sha256 = _model_identity(database, revision_id, workspace, model)
        return get_llama_pool().generate(
            repository_id=repository_id,
            revision_id=revision_id,
            model_path=model_path,
            model_sha256=model_sha256,
            model=model,
            prompt=payload.prompt,
            max_tokens=payload.max_tokens,
            temperature=payload.temperature,
            top_p=payload.top_p,
            seed=payload.seed,
            settings=settings,
            database=database,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)[:500]) from error
    except (OSError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail="llama.cpp runtime unavailable") from error


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/notebooks/execute")
async def execute_notebook(
    repository_id: UUID,
    revision_id: UUID,
    payload: ExecuteNotebookRequest,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    safe_path = normalize_repository_path(payload.notebook_path)
    if not any(
        file.path == safe_path and file.path.lower().endswith(".ipynb")
        for file in database.list_revision_files(revision_id)
    ):
        raise HTTPException(status_code=404, detail="reviewed notebook was not found")
    try:
        workspace = get_workspace_cache().materialize(database, revision_id)
        result = await to_thread(
            get_notebook_runner().execute,
            repository_id=repository_id,
            revision_id=revision_id,
            profile_id=payload.profile_id,
            notebook_path=safe_path,
            workspace=workspace,
            database=database,
        )
    except TimeoutError as error:
        raise HTTPException(status_code=408, detail=str(error)) from error
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)[:500]) from error
    return {
        "session_id": str(result.session_id),
        "status": result.status,
        "result_sha256": result.result_sha256,
        "image_digest": result.image_digest,
        "network_disabled": True,
        "secrets_injected": False,
        "download_path": f"/v1/notebooks/{result.session_id}/result",
    }


@app.get("/v1/notebooks/{session_id}/result")
def executed_notebook_result(
    session_id: UUID,
    profile_id: UUID,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> FileResponse:
    try:
        path = get_notebook_runner().result(session_id, profile_id, database)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="executed notebook result not found") from error
    except RuntimeError as error:
        raise HTTPException(
            status_code=503, detail="executed notebook result failed verification"
        ) from error
    return FileResponse(
        path,
        media_type="application/x-ipynb+json",
        filename=f"superii-executed-{session_id}.ipynb",
        content_disposition_type="attachment",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/llama/chat")
def llama_chat(
    repository_id: UUID,
    revision_id: UUID,
    payload: LlamaChatRequest,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        workspace = get_workspace_cache().materialize(database, revision_id)
        model = _model_file(workspace, payload.model_path, ".gguf")
        model_path, model_sha256 = _model_identity(database, revision_id, workspace, model)
        return get_llama_pool().generate(
            repository_id=repository_id,
            revision_id=revision_id,
            model_path=model_path,
            model_sha256=model_sha256,
            model=model,
            messages=[message.model_dump() for message in payload.messages],
            max_tokens=payload.max_tokens,
            temperature=payload.temperature,
            top_p=payload.top_p,
            seed=payload.seed,
            settings=settings,
            database=database,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)[:500]) from error
    except (OSError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail="llama.cpp runtime unavailable") from error


@app.get("/v1/repositories/{repository_id}/revisions/{revision_id}/llama/status")
def llama_status(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    current = get_llama_pool().status()
    if current.get("revision_id") not in {None, str(revision_id)}:
        return {"state": "stopped", "persistent": True, "loopback": True}
    return current


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/llama/unload")
def llama_unload(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        unloaded = get_llama_pool().unload(database, revision_id)
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"state": "stopped", "unloaded": unloaded, "persistent": True}


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/diffusers/generate")
def diffusers_generate(
    repository_id: UUID,
    revision_id: UUID,
    payload: DiffusionGenerateRequest,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        from .runtimes.diffusers_local import generate_image

        with materialized_revision(database, get_store(), revision_id) as workspace:
            image = generate_image(
                root=workspace,
                prompt=payload.prompt,
                negative_prompt=payload.negative_prompt,
                steps=payload.steps,
                guidance_scale=payload.guidance_scale,
                width=payload.width,
                height=payload.height,
                seed=payload.seed,
            )
            artifact_id = get_artifact_store().save_png(image)
    except ImportError as error:
        raise HTTPException(status_code=503, detail="Diffusers runtime is not installed") from error
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail="local diffusion generation failed") from error
    return {
        "artifact_id": str(artifact_id),
        "download_path": f"/v1/artifacts/{artifact_id}",
        "seed": payload.seed,
        "offline": True,
    }


@app.get("/v1/artifacts/{artifact_id}")
def generated_artifact(artifact_id: UUID, _auth: RuntimeAuth) -> FileResponse:
    try:
        path = get_artifact_store().resolve_png(artifact_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="artifact not found") from error
    return FileResponse(
        path,
        media_type="image/png",
        filename=f"superii-{artifact_id}.png",
        content_disposition_type="inline",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/space/start")
def start_space(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        runner = SpaceRunner(settings)
        with materialized_revision(database, get_store(), revision_id) as workspace:
            space = runner.start(workspace, repository_id, revision_id)
    except (OSError, ValueError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=str(error)[:500]) from error
    return {"container": space.container_name, "status": space.state, "local_url": space.local_url}


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/space/build")
def build_space(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        runner = SpaceRunner(settings)
        with materialized_revision(database, get_store(), revision_id) as workspace:
            return runner.build(workspace, revision_id)
    except (OSError, ValueError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=str(error)[:500]) from error


@app.get("/v1/repositories/{repository_id}/revisions/{revision_id}/space/logs")
def space_logs(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    tail: int = 200,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        logs = SpaceRunner(settings).logs(revision_id, tail)
    except (OSError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Space logs are unavailable") from error
    return {"logs": logs, "tail": min(max(tail, 1), 500)}


@app.get("/v1/repositories/{repository_id}/revisions/{revision_id}/space/status")
def space_status(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        space = SpaceRunner(settings).status(revision_id)
    except (OSError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Space supervisor is unavailable") from error
    return {"container": space.container_name, "status": space.state, "local_url": space.local_url}


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/space/stop")
def stop_space(
    repository_id: UUID,
    revision_id: UUID,
    _auth: RuntimeAuth,
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        space = SpaceRunner(settings).stop(revision_id)
    except (OSError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Space supervisor is unavailable") from error
    return {"container": space.container_name, "status": space.state, "local_url": None}


async def _close_space_proxy(upstream: httpx.Response, client: httpx.AsyncClient) -> None:
    await upstream.aclose()
    await client.aclose()


@app.api_route(
    "/v1/repositories/{repository_id}/revisions/{revision_id}/space/proxy",
    methods=SPACE_PROXY_METHODS,
)
@app.api_route(
    "/v1/repositories/{repository_id}/revisions/{revision_id}/space/proxy/{path:path}",
    methods=SPACE_PROXY_METHODS,
)
async def proxy_space(
    repository_id: UUID,
    revision_id: UUID,
    request: Request,
    _auth: RuntimeAuth,
    path: str = "",
    settings: Settings = Depends(get_settings),
    database: RepositoryDatabase = Depends(get_database),
) -> StreamingResponse:
    """Stream one published Gradio app through the authenticated runtime boundary."""

    _require_public_revision(database, repository_id, revision_id)
    if any(part == ".." for part in Path(path).parts):
        raise HTTPException(status_code=400, detail="invalid Space path")
    try:
        space = SpaceRunner(settings).status(revision_id)
    except (OSError, RuntimeError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Space supervisor is unavailable") from error
    if space.state != "running" or not space.local_url:
        raise HTTPException(status_code=503, detail="Space is not running")

    parsed = urlsplit(space.local_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(status_code=503, detail="Space endpoint failed validation")
    suffix = path.lstrip("/")
    target = f"{space.local_url.rstrip('/')}/{suffix}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in SPACE_REQUEST_HEADERS
    }
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5, read=None, write=120, pool=5),
        follow_redirects=False,
    )
    try:
        body = None if request.method in {"GET", "HEAD"} else request.stream()
        upstream = await client.send(
            client.build_request(request.method, target, headers=headers, content=body),
            stream=True,
        )
    except httpx.HTTPError as error:
        await client.aclose()
        raise HTTPException(status_code=503, detail="Space app is unavailable") from error

    response_headers = {
        name: value
        for name, value in upstream.headers.items()
        if name.lower() in SPACE_RESPONSE_HEADERS
    }
    location = response_headers.get("location")
    if location and location.startswith(space.local_url):
        public_root = f"/api/repositories/{repository_id}/space"
        response_headers["location"] = f"{public_root}{location[len(space.local_url) :]}"
    response_headers["x-content-type-options"] = "nosniff"
    response_headers["content-security-policy"] = "frame-ancestors 'self'"
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(_close_space_proxy, upstream, client),
    )


@app.post("/v1/repositories/{repository_id}/revisions/{revision_id}/tokenize")
def tokenizer_tool(
    repository_id: UUID,
    revision_id: UUID,
    payload: TokenizeRequest,
    _auth: RuntimeAuth,
    database: RepositoryDatabase = Depends(get_database),
) -> dict[str, Any]:
    _require_public_revision(database, repository_id, revision_id)
    try:
        workspace = get_workspace_cache().materialize(database, revision_id)
        return tokenize_text(workspace, payload.text, payload.add_special_tokens)
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail="tokenizer is not compatible") from error


@app.get("/v1/files/{repository_file_id}")
def download_file(
    repository_file_id: UUID,
    request: Request,
    _auth: RuntimeAuth,
    inline: bool = False,
    database: RepositoryDatabase = Depends(get_database),
) -> FileResponse:
    file = database.get_revision_file(repository_file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="file not found")
    path = get_store().resolve_key(file.storage_key)
    if not path.is_file() or get_store().sha256(path) != file.sha256:
        raise HTTPException(status_code=503, detail="stored file failed integrity verification")
    database.record_download(file, file.size_bytes, request.headers.get("user-agent"))
    preview = inline and file.mime_type.lower() in INLINE_MEDIA_TYPES
    headers = {
        "ETag": f'"sha256:{file.sha256}"',
        "X-Content-Type-Options": "nosniff",
    }
    if preview:
        headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'self'"
    return FileResponse(
        path,
        media_type=file.mime_type,
        filename=Path(file.path).name,
        content_disposition_type="inline" if preview else "attachment",
        headers=headers,
    )
