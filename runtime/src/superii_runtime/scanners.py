from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .settings import Settings


@dataclass(frozen=True, slots=True)
class ScanResult:
    scanner: str
    status: str
    tool_version: str | None
    result: dict[str, Any]

    @property
    def passed(self) -> bool:
        return self.status == "passed"


def scanner_readiness(settings: Settings) -> dict[str, bool]:
    """Verify required scanner commands, including a live clamd ping."""

    clamav = shutil.which(settings.clamav_command)
    clamav_ready = False
    if clamav is not None:
        arguments = [clamav, "--ping=1:1"]
        if settings.clamav_config_file is not None:
            arguments.append(f"--config-file={settings.clamav_config_file}")
        try:
            process = subprocess.run(
                arguments,
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
            clamav_ready = process.returncode == 0
        except (OSError, subprocess.SubprocessError):
            clamav_ready = False
    return {
        "clamav": clamav_ready,
        "gitleaks": _version(settings.gitleaks_command) is not None,
    }


def _version(command: str) -> str | None:
    executable = shutil.which(command)
    if executable is None:
        return None
    try:
        process = subprocess.run(
            [executable, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = (process.stdout or process.stderr).strip().splitlines()
    return line[0][:200] if line else None


def scan_clamav(path: Path, settings: Settings) -> ScanResult:
    executable = shutil.which(settings.clamav_command)
    version = _version(settings.clamav_command)
    if executable is None:
        return ScanResult(
            scanner="clamav",
            status="error",
            tool_version=None,
            result={"reason": "scanner_unavailable"},
        )
    try:
        arguments = [executable, "--no-summary"]
        if settings.clamav_config_file is not None:
            arguments.append(f"--config-file={settings.clamav_config_file}")
        if Path(executable).name == "clamdscan" and settings.clamav_config_file is None:
            arguments.append("--fdpass")
        arguments.append(str(path))
        process = subprocess.run(
            arguments,
            check=False,
            capture_output=True,
            text=True,
            timeout=settings.command_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return ScanResult("clamav", "error", version, {"reason": "timeout"})
    except OSError:
        return ScanResult("clamav", "error", version, {"reason": "execution_error"})

    if process.returncode == 0:
        return ScanResult("clamav", "passed", version, {"clean": True})
    if process.returncode == 1:
        return ScanResult(
            "clamav",
            "failed",
            version,
            {"clean": False, "reason": "malware_detected"},
        )
    return ScanResult(
        "clamav",
        "error",
        version,
        {"reason": "scanner_error", "exit_code": process.returncode},
    )


def scan_gitleaks(path: Path, settings: Settings) -> ScanResult:
    executable = shutil.which(settings.gitleaks_command)
    version = _version(settings.gitleaks_command)
    if executable is None:
        return ScanResult(
            scanner="gitleaks",
            status="error",
            tool_version=None,
            result={"reason": "scanner_unavailable"},
        )

    with tempfile.TemporaryDirectory(prefix="superii-gitleaks-") as report_directory:
        report_path = Path(report_directory) / "report.json"
        try:
            process = subprocess.run(
                [
                    executable,
                    "dir",
                    "--no-banner",
                    "--redact=100",
                    "--report-format=json",
                    f"--report-path={report_path}",
                    str(path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=settings.command_timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return ScanResult("gitleaks", "error", version, {"reason": "timeout"})
        except OSError:
            return ScanResult("gitleaks", "error", version, {"reason": "execution_error"})

        findings: list[dict[str, Any]] = []
        if report_path.exists():
            try:
                parsed = json.loads(report_path.read_text(encoding="utf-8"))
                if isinstance(parsed, list):
                    findings = parsed
            except (json.JSONDecodeError, OSError):
                return ScanResult(
                    "gitleaks",
                    "error",
                    version,
                    {"reason": "invalid_scanner_report"},
                )

        if process.returncode == 0 and not findings:
            return ScanResult("gitleaks", "passed", version, {"findings": 0})
        if process.returncode == 1 or findings:
            return ScanResult(
                "gitleaks",
                "failed",
                version,
                {"findings": len(findings), "reason": "secret_detected"},
            )
        return ScanResult(
            "gitleaks",
            "error",
            version,
            {"reason": "scanner_error", "exit_code": process.returncode},
        )


UNSAFE_SERIALIZATION_SUFFIXES = {
    ".bin",
    ".ckpt",
    ".joblib",
    ".pickle",
    ".pkl",
    ".pt",
    ".pth",
}


def enforce_format_policy(repository_path: str) -> ScanResult:
    suffix = Path(repository_path).suffix.lower()
    if suffix in UNSAFE_SERIALIZATION_SUFFIXES:
        return ScanResult(
            scanner="format_policy",
            status="failed",
            tool_version="superii-1",
            result={
                "reason": "unsafe_executable_serialization",
                "suffix": suffix,
                "accepted_model_format": "safetensors",
            },
        )
    return ScanResult(
        scanner="format_policy",
        status="passed",
        tool_version="superii-1",
        result={"suffix": suffix or None},
    )
