from __future__ import annotations

import json
import struct
from pathlib import Path
from uuid import UUID

import numpy as np
import pytest
from safetensors import SafetensorError
from safetensors.numpy import save_file

from superii_runtime.database import RevisionFile
from superii_runtime.inspectors.compatibility import derive_model_compatibility
from superii_runtime.inspectors.datasets import inspect_dataset
from superii_runtime.inspectors.diffusers import inspect_diffusers
from superii_runtime.inspectors.gguf import inspect_gguf
from superii_runtime.inspectors.notebooks import (
    NotebookInspectionError,
    inspect_notebooks,
)
from superii_runtime.inspectors.safetensors import inspect_safetensors


def test_safetensors_reports_shapes_dtypes_and_metadata(tmp_path: Path) -> None:
    path = tmp_path / "model.safetensors"
    save_file(
        {"layer.weight": np.zeros((2, 3), dtype=np.float32)},
        path,
        metadata={"format": "test"},
    )
    result = inspect_safetensors(path)
    assert result["valid"] is True
    assert result["tensor_count"] == 1
    assert result["tensors"][0]["name"] == "layer.weight"
    assert result["tensors"][0]["shape"] == [2, 3]
    assert result["tensors"][0]["dtype"] == "F32"
    assert result["metadata"] == {"format": "test"}


def test_dataset_inspection_is_local_and_previews_rows(tmp_path: Path) -> None:
    (tmp_path / "train.csv").write_text("name,score\nAda,10\nGrace,9\n", encoding="utf-8")
    result = inspect_dataset(tmp_path)
    assert result["row_count"] == 2
    assert result["formats"][0]["splits"]["train"]["columns"] == ["name", "score"]
    assert result["formats"][0]["splits"]["train"]["preview"][0]["name"] == "Ada"


def test_minimal_gguf_header_is_valid(tmp_path: Path) -> None:
    path = tmp_path / "empty.gguf"
    path.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 0))
    result = inspect_gguf(path)
    assert result == {
        "format": "gguf",
        "valid": True,
        "version": 3,
        "file_size_bytes": 24,
        "tensor_count": 0,
        "metadata_count": 0,
        "metadata": {},
        "tensors": [],
        "tensors_truncated": False,
    }


def test_diffusers_inspection_validates_local_components(tmp_path: Path) -> None:
    (tmp_path / "unet").mkdir()
    (tmp_path / "unet" / "config.json").write_text('{"sample_size": 64}', encoding="utf-8")
    (tmp_path / "model_index.json").write_text(
        '{"_class_name":"StableDiffusionPipeline","_diffusers_version":"0.40.0",'
        '"unet":["diffusers","UNet2DConditionModel"]}',
        encoding="utf-8",
    )
    result = inspect_diffusers(tmp_path)
    assert result["valid"] is True
    assert result["pipeline_class"] == "StableDiffusionPipeline"
    assert result["components"][0]["name"] == "unet"
    assert result["repository_code_executed"] is False


def test_invalid_safetensors_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "bad.safetensors"
    path.write_bytes(struct.pack("<Q", 100) + b"{}")
    with pytest.raises((ValueError, SafetensorError)):
        inspect_safetensors(path)


def test_compatibility_derives_gguf_memory_and_llama_cpp_support(tmp_path: Path) -> None:
    model = tmp_path / "tiny.Q4_K_M.gguf"
    model.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 0))
    file = RevisionFile(
        id=UUID("11111111-1111-4111-8111-111111111111"),
        repository_id=UUID("22222222-2222-4222-8222-222222222222"),
        revision_id=UUID("33333333-3333-4333-8333-333333333333"),
        path=model.name,
        size_bytes=model.stat().st_size,
        mime_type="application/octet-stream",
        sha256="0" * 64,
        storage_key="objects/sha256/00/" + "0" * 64,
    )
    result = derive_model_compatibility(
        tmp_path,
        {"model": None, "safetensors": [], "gguf": [{"inspection": inspect_gguf(model)}]},
        [file],
    )
    assert result["quantization"] == "Q4_K_M"
    assert result["tensor_format"] == "gguf"
    assert result["llama_cpp_compatible"] is True
    assert result["cpu_compatible"] is True
    assert result["minimum_ram_bytes"] >= 1024**3
    assert result["confidence"] == "derived"


def test_compatibility_accepts_bounded_publisher_declaration(tmp_path: Path) -> None:
    (tmp_path / "superii-compatibility.json").write_text(
        json.dumps(
            {
                "minimum_ram_bytes": 8 * 1024**3,
                "metal_compatible": True,
                "mlx_compatible": True,
                "evidence_urls": ["https://example.com/benchmark"],
            }
        ),
        encoding="utf-8",
    )
    result = derive_model_compatibility(tmp_path, {"model": {}}, [])
    assert result["minimum_ram_bytes"] == 8 * 1024**3
    assert result["mlx_compatible"] is True
    assert result["confidence"] == "declared"


def test_notebook_inspection_is_static_and_omits_active_outputs(tmp_path: Path) -> None:
    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
            "language_info": {"name": "python", "version": "3.12"},
        },
        "cells": [
            {
                "id": "intro",
                "cell_type": "markdown",
                "metadata": {},
                "source": "# Safe title\n<script>alert(1)</script>",
            },
            {
                "id": "code",
                "cell_type": "code",
                "metadata": {},
                "source": "print('hello')",
                "execution_count": 1,
                "outputs": [
                    {"output_type": "stream", "name": "stdout", "text": "hello\n"},
                    {
                        "output_type": "display_data",
                        "metadata": {},
                        "data": {
                            "text/plain": "trusted as escaped text",
                            "text/html": "<img src=x onerror=alert(1)>",
                            "application/javascript": "alert(1)",
                            "image/svg+xml": "<svg onload=alert(1)></svg>",
                        },
                    },
                ],
            },
        ],
    }
    (tmp_path / "safe.ipynb").write_text(json.dumps(notebook), encoding="utf-8")

    result = inspect_notebooks(tmp_path)

    inspected = result["notebooks"][0]
    assert result["code_executed"] is False
    assert inspected["safety"]["raw_html_rendered"] is False
    assert inspected["cells"][0]["source"].endswith("</script>")
    assert inspected["cells"][1]["outputs"][1]["data"] == [
        {"mime_type": "text/plain", "text": "trusted as escaped text"}
    ]
    assert "text/html" not in json.dumps(inspected["cells"][1]["outputs"])


def test_notebook_inspection_rejects_invalid_nbformat(tmp_path: Path) -> None:
    (tmp_path / "invalid.ipynb").write_text('{"nbformat":4,"cells":[]}', encoding="utf-8")
    with pytest.raises(NotebookInspectionError, match="failed nbformat validation"):
        inspect_notebooks(tmp_path)


def test_notebook_inspection_rejects_invalid_embedded_image(tmp_path: Path) -> None:
    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {
                "id": "image",
                "cell_type": "code",
                "metadata": {},
                "source": "display(image)",
                "execution_count": None,
                "outputs": [
                    {
                        "output_type": "display_data",
                        "metadata": {},
                        "data": {"image/png": "not-base64"},
                    }
                ],
            }
        ],
    }
    (tmp_path / "bad-image.ipynb").write_text(json.dumps(notebook), encoding="utf-8")
    with pytest.raises(NotebookInspectionError, match="not valid base64"):
        inspect_notebooks(tmp_path)


def test_notebook_inspection_enforces_file_size_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import superii_runtime.inspectors.notebooks as notebook_inspector

    monkeypatch.setattr(notebook_inspector, "MAX_NOTEBOOK_BYTES", 8)
    (tmp_path / "large.ipynb").write_text("{}" * 5, encoding="utf-8")
    with pytest.raises(NotebookInspectionError, match="25 MiB notebook limit"):
        inspect_notebooks(tmp_path)
