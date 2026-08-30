from __future__ import annotations

import importlib.util
from pathlib import Path


def test_foundation_benchmark_emits_bounded_measured_contract() -> None:
    script = Path(__file__).parents[1] / "scripts" / "benchmark-foundation.py"
    spec = importlib.util.spec_from_file_location("benchmark_foundation", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    result = module.run(1, 1)

    assert result["schema_version"] == 1
    assert result["fixture"]["size_bytes"] == 1024 * 1024
    assert result["measurements"]["full_sha256"]["median_seconds"] >= 0
    assert "not a model-loading" in result["claim_boundary"]
