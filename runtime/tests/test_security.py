from __future__ import annotations

import subprocess
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
from safetensors.numpy import save_file

from superii_runtime.capabilities import capability_report
from superii_runtime.pipeline import _scan_staged
from superii_runtime.scanners import (
    ScanResult,
    enforce_format_policy,
    scan_clamav,
    scan_gitleaks,
    scan_gitleaks_document,
    scanner_readiness,
)
from superii_runtime.settings import Settings
from superii_runtime.storage import StagedObject


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


def test_tcp_clamd_receives_a_stream_instead_of_a_host_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "file.txt"
    path.write_text("clean text", encoding="utf-8")
    config = tmp_path / "clamd.conf"
    config.write_text("TCPSocket 3310\nTCPAddr 127.0.0.1\n", encoding="utf-8")
    calls: list[list[str]] = []

    monkeypatch.setattr(
        "superii_runtime.scanners.shutil.which",
        lambda command: "/usr/local/bin/clamdscan" if command == "clamdscan" else None,
    )

    def fake_run(arguments: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(arguments)
        return subprocess.CompletedProcess(arguments, 0, stdout="ClamAV 1.5.4", stderr="")

    monkeypatch.setattr("superii_runtime.scanners.subprocess.run", fake_run)
    result = scan_clamav(
        path,
        Settings(
            storage_root=tmp_path / "data",
            clamav_command="clamdscan",
            clamav_config_file=config,
        ),
    )

    assert result.status == "passed"
    assert result.tool_version == "ClamAV 1.5.4"
    assert calls[0] == [
        "/usr/local/bin/clamdscan",
        f"--config-file={config}",
        "--version",
    ]
    assert "--stream" in calls[-1]
    assert "--fdpass" not in calls[-1]


def test_failed_version_command_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "superii_runtime.scanners.shutil.which",
        lambda _: "/usr/local/bin/scanner",
    )
    monkeypatch.setattr(
        "superii_runtime.scanners.subprocess.run",
        lambda arguments, **_: subprocess.CompletedProcess(
            arguments, 2, stdout="", stderr="configuration error"
        ),
    )
    from superii_runtime.scanners import _version

    assert _version("scanner") is None


def test_structured_document_secret_scan_records_its_bounded_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    scanned: list[str] = []

    monkeypatch.setattr(
        "superii_runtime.scanners.shutil.which",
        lambda _: "/usr/local/bin/gitleaks",
    )

    def fake_run(arguments: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(arguments)
        if arguments[-1] == "--version":
            return subprocess.CompletedProcess(arguments, 0, stdout="gitleaks version 8.30.1")
        scanned.append(Path(arguments[-1]).read_text(encoding="utf-8"))
        return subprocess.CompletedProcess(arguments, 0, stdout="", stderr="")

    monkeypatch.setattr("superii_runtime.scanners.subprocess.run", fake_run)
    result = scan_gitleaks_document(
        {"metadata": {"format": "mlx"}, "tensors": [{"name": "layer.weight"}]},
        Settings(storage_root=tmp_path / "data"),
        mode="safetensors-structure-and-metadata",
    )

    assert result.status == "passed"
    assert result.tool_version == "gitleaks version 8.30.1"
    assert result.result["mode"] == "safetensors-structure-and-metadata"
    assert result.result["scanned_bytes"] == len(scanned[0].encode())
    assert "layer.weight" in scanned[0]
    assert len(calls) == 2


def test_resumable_safetensors_payload_keeps_declared_format(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = tmp_path / "payload"
    save_file(
        {"layer.weight": np.zeros((2, 3), dtype=np.float32)},
        payload,
        metadata={"format": "mlx"},
    )
    staged = StagedObject(
        upload_id=uuid4(),
        path="weights/model.safetensors",
        size_bytes=payload.stat().st_size,
        mime_type="application/octet-stream",
        sha256="a" * 64,
        storage_key="quarantine/fixture/payload",
        absolute_path=payload,
    )
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(
        "superii_runtime.pipeline.scan_clamav",
        lambda *_: ScanResult("clamav", "passed", "ClamAV fixture", {"clean": True}),
    )
    monkeypatch.setattr(
        "superii_runtime.pipeline.scan_gitleaks",
        lambda *_: (_ for _ in ()).throw(AssertionError("opaque tensor bytes were scanned")),
    )

    def structured(document: dict[str, object], *_: object, **__: object) -> ScanResult:
        captured.append(document)
        return ScanResult(
            "gitleaks",
            "passed",
            "gitleaks fixture",
            {"findings": 0, "mode": "safetensors-structure-and-metadata"},
        )

    monkeypatch.setattr("superii_runtime.pipeline.scan_gitleaks_document", structured)
    results = {
        result.scanner: result
        for result in _scan_staged(staged, Settings(storage_root=tmp_path / "data"))
    }

    assert results["safetensors"].status == "passed"
    assert results["safetensors"].result["tensor_count"] == 1
    assert results["gitleaks"].status == "passed"
    assert captured[0]["metadata"] == {"format": "mlx"}


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
