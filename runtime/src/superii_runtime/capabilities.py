from __future__ import annotations

import importlib.util
import shutil
from typing import Any

from .settings import Settings


def capability_report(settings: Settings) -> dict[str, Any]:
    """Expose honest activation state; deferred systems are never reported as running."""

    return {
        "repository_core": {
            "phase": "implemented",
            "storage": "local_content_addressed_filesystem",
            "xet": False,
        },
        "resumable_transfers": {
            "phase": "implemented",
            "protocol": "tus-1.0.0",
            "max_upload_bytes": settings.max_upload_bytes,
            "max_chunk_bytes": settings.transfer_max_chunk_bytes,
            "service": "rust_loopback_sidecar",
        },
        "safetensors": {
            "phase": "implemented",
            "available": _installed("safetensors"),
            "offline": True,
        },
        "datasets": {
            "phase": "implemented",
            "available": _installed("datasets"),
            "offline": True,
        },
        "transformers": {
            "phase": "implemented",
            "available": _installed("transformers"),
            "local_files_only": True,
            "trust_remote_code": False,
        },
        "tokenizers": {
            "phase": "implemented",
            "available": _installed("tokenizers"),
            "offline": True,
        },
        "notebooks": {
            "phase": "implemented_isolated_execution",
            "available": _installed("nbformat"),
            "nbformat": "4",
            "code_execution": shutil.which("docker") is not None,
            "active_outputs": True,
            "network": "disabled",
            "secrets_injected": False,
        },
        "transformers_js": {
            "phase": "implemented_in_web_control_plane",
            "remote_models": False,
            "commercial_api": False,
        },
        "llama_cpp": {
            "phase": "implemented_persistent",
            "available": shutil.which(settings.llama_server_command) is not None,
            "continuous_batching": True,
            "network": "loopback_only",
            "commercial_api": False,
        },
        "diffusers": {
            "phase": "implemented_optional",
            "available": _installed("diffusers") and _installed("torch"),
            "commercial_api": False,
        },
        "gradio_spaces": {
            "phase": "implemented",
            "available": shutil.which("docker") is not None,
            "frameworks": ["gradio"],
            "network_egress": False,
        },
        "postgres_search": {"phase": "implemented", "semantic": False},
        "vllm": {
            "phase": "deferred_until_dedicated_gpu",
            "enabled": settings.vllm_enabled,
            "available": False,
        },
        "semantic_search_tei": {
            "phase": "deferred_until_postgres_search_scale_limit",
            "enabled": settings.semantic_search_enabled,
            "available": False,
        },
        "clamav": {
            "phase": "required_publication_gate",
            "client_available": shutil.which(settings.clamav_command) is not None,
        },
        "gitleaks": {
            "phase": "required_publication_gate",
            "available": shutil.which(settings.gitleaks_command) is not None,
        },
        "community": {
            "phase": "implemented_in_postgres_control_plane",
            "features": ["discussions", "comments", "reactions", "events"],
        },
        "social_graph": {
            "phase": "implemented_in_postgres_control_plane",
            "features": ["likes", "follows", "watchers", "activity"],
        },
        "collections": {"phase": "implemented_in_postgres_control_plane"},
        "lineage": {"phase": "implemented_in_postgres_control_plane"},
    }


def _installed(package: str) -> bool:
    return importlib.util.find_spec(package) is not None
