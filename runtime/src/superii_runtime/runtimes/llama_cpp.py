from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ..settings import Settings

TOKEN_PATTERN = re.compile(r"(?:/|in)\s+(\d+)\s+(?:tokens|runs)", re.IGNORECASE)


def _offline_environment() -> dict[str, str]:
    allowed = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "TMPDIR", "LANG", "LC_ALL"}
    }
    allowed.update(
        {
            "HF_HUB_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
    )
    return allowed


def generate(
    *,
    model: Path,
    prompt: str,
    max_tokens: int,
    temperature: float,
    top_p: float,
    seed: int,
    settings: Settings,
    conversation: bool = False,
) -> dict[str, Any]:
    executable = shutil.which(settings.llama_cli_command)
    if executable is None:
        raise RuntimeError("llama.cpp CLI is unavailable")
    resolved = model.resolve(strict=True)
    if resolved.suffix.lower() != ".gguf":
        raise ValueError("llama.cpp accepts only GGUF model files")
    command = [
        executable,
        "--model",
        str(resolved),
        "--prompt",
        prompt,
        "--n-predict",
        str(max_tokens),
        "--temp",
        str(temperature),
        "--top-p",
        str(top_p),
        "--seed",
        str(seed),
        "--no-display-prompt",
        "--simple-io",
    ]
    if conversation:
        command.append("--conversation")
    process = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=settings.command_timeout_seconds,
        env=_offline_environment(),
    )
    if process.returncode != 0:
        raise RuntimeError(f"llama.cpp failed with exit code {process.returncode}")
    token_counts = [int(match) for match in TOKEN_PATTERN.findall(process.stderr)]
    return {
        "text": process.stdout,
        "model": resolved.name,
        "max_tokens": max_tokens,
        "token_statistics": {
            "reported_counts": token_counts,
            "timings": [
                line.strip()
                for line in process.stderr.splitlines()
                if "time" in line.lower() and len(line) < 500
            ][-20:],
        },
        "runtime": "llama.cpp",
        "offline": True,
    }
