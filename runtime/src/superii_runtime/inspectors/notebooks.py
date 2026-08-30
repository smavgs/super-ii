from __future__ import annotations

import base64
import binascii
import json
from pathlib import Path
from typing import Any

import nbformat
from nbformat import ValidationError

MAX_NOTEBOOK_BYTES = 25 * 1024 * 1024
MAX_NOTEBOOKS = 32
MAX_CELLS = 2_000
MAX_CELL_SOURCE_CHARS = 250_000
MAX_TOTAL_SOURCE_CHARS = 5_000_000
MAX_OUTPUTS_PER_CELL = 100
MAX_TEXT_OUTPUT_CHARS = 250_000
MAX_TOTAL_OUTPUT_CHARS = 8_000_000
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024
SAFE_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


class NotebookInspectionError(ValueError):
    """Raised when a notebook cannot safely enter the static-view contract."""


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(part, str) for part in value):
        return "".join(value)
    raise NotebookInspectionError("notebook text fields must contain strings")


def _bounded_text(value: Any, *, limit: int, label: str) -> str:
    text = _text(value)
    if len(text) > limit:
        raise NotebookInspectionError(f"{label} exceeds the static-view limit")
    return text


def _metadata_text(value: Any, *, limit: int = 200) -> str | None:
    if not isinstance(value, str):
        return None
    clean = value.strip()
    return clean[:limit] if clean else None


def _safe_json(value: Any) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as error:
        raise NotebookInspectionError("notebook JSON output is not serializable") from error
    if len(encoded) > MAX_TEXT_OUTPUT_CHARS:
        raise NotebookInspectionError("notebook JSON output exceeds the static-view limit")
    return json.loads(encoded)


def _safe_image(mime_type: str, value: Any) -> dict[str, Any]:
    encoded = _bounded_text(value, limit=MAX_IMAGE_BYTES * 2, label=mime_type).replace("\n", "")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise NotebookInspectionError(f"{mime_type} output is not valid base64") from error
    if len(decoded) > MAX_IMAGE_BYTES:
        raise NotebookInspectionError(f"{mime_type} output exceeds the static-view limit")
    return {"mime_type": mime_type, "data": encoded, "size_bytes": len(decoded)}


def _safe_output(output: Any) -> tuple[dict[str, Any] | None, int, int]:
    output_type = output.get("output_type")
    if output_type == "stream":
        text = _bounded_text(
            output.get("text", ""), limit=MAX_TEXT_OUTPUT_CHARS, label="stream output"
        )
        return (
            {
                "type": "stream",
                "name": "stderr" if output.get("name") == "stderr" else "stdout",
                "text": text,
            },
            len(text),
            0,
        )
    if output_type == "error":
        traceback = [
            _bounded_text(line, limit=MAX_TEXT_OUTPUT_CHARS, label="traceback line")
            for line in output.get("traceback", [])[:100]
        ]
        ename = _metadata_text(output.get("ename")) or "Error"
        evalue = _metadata_text(output.get("evalue"), limit=1_000) or ""
        text_size = len(ename) + len(evalue) + sum(len(line) for line in traceback)
        if text_size > MAX_TEXT_OUTPUT_CHARS:
            raise NotebookInspectionError("error output exceeds the static-view limit")
        return (
            {"type": "error", "ename": ename, "evalue": evalue, "traceback": traceback},
            text_size,
            0,
        )
    if output_type not in {"display_data", "execute_result"}:
        return None, 0, 0

    data = output.get("data")
    if not isinstance(data, dict):
        raise NotebookInspectionError("rich notebook output must contain a MIME bundle")
    safe_data: list[dict[str, Any]] = []
    text_size = 0
    image_size = 0
    if "text/plain" in data:
        text = _bounded_text(
            data["text/plain"], limit=MAX_TEXT_OUTPUT_CHARS, label="text/plain output"
        )
        safe_data.append({"mime_type": "text/plain", "text": text})
        text_size += len(text)
    if "application/json" in data:
        value = _safe_json(data["application/json"])
        safe_data.append({"mime_type": "application/json", "value": value})
        text_size += len(json.dumps(value, ensure_ascii=False))
    for mime_type in sorted(SAFE_IMAGE_MIME_TYPES):
        if mime_type in data:
            image = _safe_image(mime_type, data[mime_type])
            safe_data.append(image)
            image_size += int(image["size_bytes"])
    if not safe_data:
        return None, 0, 0
    safe: dict[str, Any] = {"type": output_type, "data": safe_data}
    if output_type == "execute_result":
        count = output.get("execution_count")
        safe["execution_count"] = count if isinstance(count, int) and count >= 0 else None
    return safe, text_size, image_size


def inspect_notebook(path: Path, root: Path) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    size_bytes = resolved.stat().st_size
    if size_bytes > MAX_NOTEBOOK_BYTES:
        raise NotebookInspectionError(f"{path.name} exceeds the 25 MiB notebook limit")
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise NotebookInspectionError(f"{path.name} is not valid UTF-8 notebook JSON") from error
    if not isinstance(raw, dict) or raw.get("nbformat") != 4:
        raise NotebookInspectionError(f"{path.name} must use Jupyter nbformat 4")
    try:
        notebook = nbformat.from_dict(raw)
        nbformat.validate(notebook)
    except (AttributeError, TypeError, ValidationError, ValueError) as error:
        raise NotebookInspectionError(f"{path.name} failed nbformat validation") from error

    cells = notebook.get("cells", [])
    if len(cells) > MAX_CELLS:
        raise NotebookInspectionError(f"{path.name} exceeds the cell-count limit")
    safe_cells: list[dict[str, Any]] = []
    total_source_chars = 0
    total_output_chars = 0
    total_image_bytes = 0
    omitted_outputs = 0
    for index, cell in enumerate(cells):
        source = _bounded_text(
            cell.get("source", ""), limit=MAX_CELL_SOURCE_CHARS, label=f"cell {index} source"
        )
        total_source_chars += len(source)
        if total_source_chars > MAX_TOTAL_SOURCE_CHARS:
            raise NotebookInspectionError(f"{path.name} exceeds the total source limit")
        cell_type = cell.get("cell_type")
        safe_cell: dict[str, Any] = {
            "index": index,
            "type": cell_type,
            "source": source,
        }
        cell_id = _metadata_text(cell.get("id"), limit=64)
        if cell_id:
            safe_cell["id"] = cell_id
        if cell_type == "code":
            count = cell.get("execution_count")
            safe_cell["execution_count"] = count if isinstance(count, int) and count >= 0 else None
            outputs = cell.get("outputs", [])
            if len(outputs) > MAX_OUTPUTS_PER_CELL:
                raise NotebookInspectionError(f"cell {index} exceeds the output-count limit")
            safe_outputs: list[dict[str, Any]] = []
            for output in outputs:
                safe_output, text_chars, image_bytes = _safe_output(output)
                if safe_output is None:
                    omitted_outputs += 1
                    continue
                total_output_chars += text_chars
                total_image_bytes += image_bytes
                if total_output_chars > MAX_TOTAL_OUTPUT_CHARS:
                    raise NotebookInspectionError(f"{path.name} exceeds the text-output limit")
                if total_image_bytes > MAX_TOTAL_IMAGE_BYTES:
                    raise NotebookInspectionError(f"{path.name} exceeds the image-output limit")
                safe_outputs.append(safe_output)
            safe_cell["outputs"] = safe_outputs
        safe_cells.append(safe_cell)

    metadata = notebook.get("metadata", {})
    kernelspec = metadata.get("kernelspec", {}) if isinstance(metadata, dict) else {}
    language = metadata.get("language_info", {}) if isinstance(metadata, dict) else {}
    return {
        "version": 1,
        "path": resolved.relative_to(root.resolve(strict=True)).as_posix(),
        "size_bytes": size_bytes,
        "nbformat": 4,
        "nbformat_minor": int(notebook.get("nbformat_minor", 0)),
        "kernel": {
            "name": _metadata_text(kernelspec.get("name"))
            if isinstance(kernelspec, dict)
            else None,
            "display_name": (
                _metadata_text(kernelspec.get("display_name"))
                if isinstance(kernelspec, dict)
                else None
            ),
            "language": (
                _metadata_text(language.get("name")) if isinstance(language, dict) else None
            ),
            "language_version": (
                _metadata_text(language.get("version")) if isinstance(language, dict) else None
            ),
        },
        "cell_count": len(safe_cells),
        "cells": safe_cells,
        "omitted_outputs": omitted_outputs,
        "safety": {
            "static_only": True,
            "code_executed": False,
            "repository_code_imported": False,
            "raw_html_rendered": False,
            "javascript_rendered": False,
            "svg_rendered": False,
            "widgets_rendered": False,
            "attachments_rendered": False,
        },
    }


def inspect_notebooks(root: Path) -> dict[str, Any]:
    """Validate and normalize local notebooks without importing or executing their code."""

    resolved = root.resolve(strict=True)
    notebooks = sorted(resolved.rglob("*.ipynb"))
    if len(notebooks) > MAX_NOTEBOOKS:
        raise NotebookInspectionError("revision exceeds the notebook-count limit")
    inspected = [inspect_notebook(path, resolved) for path in notebooks]
    return {
        "version": 1,
        "notebook_count": len(inspected),
        "notebooks": inspected,
        "static_only": True,
        "code_executed": False,
    }
