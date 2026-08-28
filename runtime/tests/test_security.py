from __future__ import annotations

from pathlib import Path

import pytest

from superii_runtime.capabilities import capability_report
from superii_runtime.scanners import (
    enforce_format_policy,
    scan_clamav,
    scan_gitleaks,
    scanner_readiness,
)
from superii_runtime.settings import Settings


def test_unsafe_pickle_style_formats_fail_policy() -> None:
    result = enforce_format_policy("weights/pytorch_model.bin")
    assert result.status == "failed"
    assert result.result["accepted_model_format"] == "safetensors"


def test_missing_scanners_fail_closed(tmp_path: Path) -> None:
    path = tmp_path / "file.txt"
    path.write_text("clean text", encoding="utf-8")
    settings = Settings(
        storage_root=tmp_path / "data",
        clamav_command="superii-no-such-clamav",
        gitleaks_command="superii-no-such-gitleaks",
    )
    assert scan_clamav(path, settings).status == "error"
    assert scan_gitleaks(path, settings).status == "error"
    assert scanner_readiness(settings) == {"clamav": False, "gitleaks": False}


def test_scaling_runtimes_are_explicitly_deferred(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "data")
    report = capability_report(settings)
    assert report["vllm"]["phase"] == "deferred_until_dedicated_gpu"
    assert report["vllm"]["available"] is False
    assert report["semantic_search_tei"]["available"] is False


def test_wildcard_bind_requires_explicit_opt_in(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="ALLOW_WILDCARD_BIND"):
        Settings(host="0.0.0.0", storage_root=tmp_path / "data")
    configured = Settings(
        host="0.0.0.0",
        allow_wildcard_bind=True,
        storage_root=tmp_path / "data",
    )
    assert configured.host == "0.0.0.0"
