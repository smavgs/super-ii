from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MAX_CONFIG_BYTES = 4 * 1024 * 1024


def _read_object(path: Path) -> dict[str, Any]:
    if path.stat().st_size > MAX_CONFIG_BYTES:
        raise ValueError(f"Diffusers configuration is too large: {path.name}")
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError(f"Diffusers configuration must be an object: {path.name}")
    return parsed


def inspect_diffusers(root: Path) -> dict[str, Any]:
    """Inspect a local Diffusers layout without importing or executing repository code."""

    resolved = root.resolve(strict=True)
    model_index_path = resolved / "model_index.json"
    if not model_index_path.is_file():
        raise ValueError("model_index.json was not found")
    model_index = _read_object(model_index_path)
    pipeline_class = model_index.get("_class_name")
    if not isinstance(pipeline_class, str) or not pipeline_class:
        raise ValueError("Diffusers _class_name is missing")

    components: list[dict[str, Any]] = []
    for name, reference in sorted(model_index.items()):
        if name.startswith("_"):
            continue
        if not (
            isinstance(reference, list)
            and len(reference) == 2
            and all(value is None or isinstance(value, str) for value in reference)
        ):
            raise ValueError(f"Diffusers component reference is invalid: {name}")
        component_directory = resolved / name
        if not component_directory.is_dir():
            raise ValueError(f"Diffusers component directory is missing: {name}")
        config_files = []
        for filename in ("config.json", "scheduler_config.json", "tokenizer_config.json"):
            candidate = component_directory / filename
            if candidate.is_file():
                _read_object(candidate)
                config_files.append(filename)
        components.append(
            {
                "name": name,
                "library": reference[0],
                "class": reference[1],
                "config_files": config_files,
            }
        )

    return {
        "format": "diffusers",
        "valid": True,
        "pipeline_class": pipeline_class,
        "diffusers_version": model_index.get("_diffusers_version"),
        "components": components,
        "offline": True,
        "repository_code_executed": False,
    }
