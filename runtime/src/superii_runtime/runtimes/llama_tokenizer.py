from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from ..settings import Settings
from .llama_cpp import _offline_environment

MAX_TOKEN_IDS = 100_000
MAX_OUTPUT_BYTES = 2 * 1024 * 1024


class LlamaTokenizerVerifier:
    """Use pinned llama.cpp as a publication-time GGUF tokenizer oracle."""

    def encode_ids(
        self,
        artifact: Path,
        source_sha256: str,
        text: str,
        *,
        add_special_tokens: bool,
        settings: Settings,
    ) -> list[int]:
        if len(text) > 100_000:
            raise ValueError("tokenizer input exceeds 100000 characters")
        if not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
            raise ValueError("GGUF tokenizer source hash is invalid")
        resolved = artifact.resolve(strict=True)
        if resolved.is_symlink() or not resolved.is_file() or resolved.suffix.lower() != ".gguf":
            raise ValueError("llama.cpp tokenizer accepts only a verified local GGUF source")
        executable = shutil.which(settings.llama_tokenize_command)
        if executable is None:
            raise RuntimeError("llama.cpp tokenizer verifier is unavailable")
        command = [
            executable,
            "--model",
            str(resolved),
            "--stdin",
            "--ids",
            "--offline",
            "--log-disable",
        ]
        if not add_special_tokens:
            command.append("--no-bos")
        process = subprocess.run(
            command,
            input=text,
            capture_output=True,
            text=True,
            check=False,
            timeout=min(settings.command_timeout_seconds, 120),
            env=_offline_environment(),
        )
        if process.returncode != 0:
            raise RuntimeError("llama.cpp tokenizer verification failed")
        encoded = process.stdout.strip().encode("utf-8")
        if not encoded or len(encoded) > MAX_OUTPUT_BYTES:
            raise RuntimeError("llama.cpp returned invalid tokenizer output")
        try:
            token_ids = json.loads(encoded)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("llama.cpp returned invalid tokenizer output") from error
        if (
            not isinstance(token_ids, list)
            or len(token_ids) > MAX_TOKEN_IDS
            or any(
                type(token_id) is not int or token_id < 0 or token_id > 2**31 - 1
                for token_id in token_ids
            )
        ):
            raise RuntimeError("llama.cpp returned invalid token IDs")
        return token_ids
