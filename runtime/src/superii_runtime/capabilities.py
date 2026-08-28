from __future__ import annotations

import importlib.util
import shutil
from typing import Any

from .settings import Settings


def capability_report(settings: Settings) -> dict[str, Any]:
    """Expose honest activation state; deferred systems are never reported as running."""

    return {
        "llama_cpp": {
            "phase": "implemented",
            "available": shutil.which(settings.llama_cli_command) is not None,
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
        },
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
    }


def _installed(package: str) -> bool:
    return importlib.util.find_spec(package) is not None
