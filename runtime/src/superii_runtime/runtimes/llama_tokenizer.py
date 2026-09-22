from __future__ import annotations

import atexit
import hashlib
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from ..settings import Settings
from .llama_cpp import _offline_environment


@dataclass(slots=True)
class _TokenizerInstance:
    pack_sha256: str
    artifact: Path
    port: int
    process: subprocess.Popen[bytes]
    log: Any
    key_file: Path
    key: str
    last_used_at: float


class LlamaTokenizerPool:
    """Serve one verified vocab-only GGUF without allocating model weights."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._instance: _TokenizerInstance | None = None
        atexit.register(self.close)

    def encode(
        self,
        artifact: Path,
        pack_sha256: str,
        text: str,
        *,
        add_special_tokens: bool,
        special_token_ids: set[int] | None = None,
        settings: Settings,
    ) -> dict[str, Any]:
        if len(text) > 100_000:
            raise ValueError("tokenizer input exceeds 100000 characters")
        # The pool intentionally keeps one vocab-only process. Hold the lock for
        # the complete request so another model cannot replace that process
        # between client creation and the HTTP response.
        with self._lock, self._client(artifact, pack_sha256, settings) as client:
            response = client.post(
                "/tokenize",
                json={
                    "content": text,
                    "add_special": add_special_tokens,
                    "parse_special": True,
                    "with_pieces": True,
                },
            )
            if response.status_code >= 400:
                raise ValueError("llama.cpp rejected the tokenizer input")
            payload = response.json()
            raw_tokens = payload.get("tokens")
            if not isinstance(raw_tokens, list) or len(raw_tokens) > 100_000:
                raise RuntimeError("llama.cpp returned invalid token metadata")

            token_ids: list[int] = []
            raw_pieces: list[str | list[int]] = []
            for item in raw_tokens:
                if not isinstance(item, dict) or type(item.get("id")) is not int:
                    raise RuntimeError("llama.cpp omitted token IDs or pieces")
                token_id = int(item["id"])
                piece = item.get("piece")
                if isinstance(piece, str):
                    raw_piece: str | list[int] = piece
                elif isinstance(piece, list) and all(
                    type(value) is int and 0 <= value <= 255 for value in piece
                ):
                    raw_piece = [int(value) for value in piece]
                else:
                    raise RuntimeError("llama.cpp returned an invalid token piece")
                token_ids.append(token_id)
                raw_pieces.append(raw_piece)

            decoded = self._detokenize(client, token_ids)
            pieces, offsets_verified = self._pieces(
                raw_pieces,
                token_ids,
                special_token_ids or set(),
                text,
            )
            return {
                "tokens": [piece["token"] for piece in pieces],
                "token_ids": token_ids,
                "pieces": pieces,
                "token_count": len(token_ids),
                "decoded": decoded,
                "decoded_sha256": hashlib.sha256(decoded.encode("utf-8")).hexdigest(),
                "add_special_tokens": add_special_tokens,
                "engine": "llama.cpp",
                "tokenizer_class": "GGUF vocabulary",
                "context_length": None,
                "offsets_verified": offsets_verified,
            }

    def decode(
        self,
        artifact: Path,
        pack_sha256: str,
        token_ids: list[int],
        *,
        skip_special_tokens: bool,
        special_token_ids: set[int] | None = None,
        settings: Settings,
    ) -> dict[str, Any]:
        if not token_ids or len(token_ids) > 100_000:
            raise ValueError("decode requires between 1 and 100000 token IDs")
        if any(type(value) is not int or value < 0 or value > 2**31 - 1 for value in token_ids):
            raise ValueError("token IDs must be non-negative 32-bit integers")
        decoded_ids = (
            [value for value in token_ids if value not in (special_token_ids or set())]
            if skip_special_tokens
            else token_ids
        )
        with self._lock, self._client(artifact, pack_sha256, settings) as client:
            text = self._detokenize(client, decoded_ids) if decoded_ids else ""
        return {
            "text": text,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "token_ids": token_ids,
            "token_count": len(token_ids),
            "skip_special_tokens": skip_special_tokens,
            "skip_special_tokens_applied": True,
            "engine": "llama.cpp",
            "tokenizer_class": "GGUF vocabulary",
        }

    def close(self) -> None:
        with self._lock:
            self._stop_locked()

    def _client(
        self,
        artifact: Path,
        pack_sha256: str,
        settings: Settings,
    ) -> httpx.Client:
        instance = self._instance_for(artifact, pack_sha256, settings)
        return httpx.Client(
            base_url=f"http://127.0.0.1:{instance.port}",
            timeout=settings.command_timeout_seconds,
            trust_env=False,
            headers={"Authorization": f"Bearer {instance.key}"},
        )

    def _instance_for(
        self,
        artifact: Path,
        pack_sha256: str,
        settings: Settings,
    ) -> _TokenizerInstance:
        with self._lock:
            instance = self._instance
            if instance is not None and (
                instance.process.poll() is not None
                or time.monotonic() - instance.last_used_at >= settings.llama_server_idle_seconds
                or instance.pack_sha256 != pack_sha256
            ):
                self._stop_locked()
                instance = None
            if instance is None:
                instance = self._start(artifact, pack_sha256, settings)
                self._instance = instance
            instance.last_used_at = time.monotonic()
            return instance

    def _start(
        self,
        artifact: Path,
        pack_sha256: str,
        settings: Settings,
    ) -> _TokenizerInstance:
        executable = shutil.which(settings.llama_server_command)
        if executable is None:
            raise RuntimeError("llama.cpp tokenizer runtime is unavailable")
        if not re.fullmatch(r"[a-f0-9]{64}", pack_sha256):
            raise ValueError("llama.cpp tokenizer pack hash is invalid")
        resolved = artifact.resolve(strict=True)
        if resolved.is_symlink() or not resolved.is_file() or resolved.suffix.lower() != ".gguf":
            raise ValueError("llama.cpp tokenizer accepts only a verified local GGUF pack")
        port = self._available_port()
        log_root = settings.storage_root / "runtime" / "tokenizers"
        log_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        log_path = log_root / f"{pack_sha256}.log"
        key_file = log_root / f"{pack_sha256}.key"
        key = secrets.token_urlsafe(32)
        key_file.write_text(key, encoding="utf-8")
        key_file.chmod(0o600)
        log = log_path.open("ab")
        log_path.chmod(0o640)
        command = [
            executable,
            "--model",
            str(resolved),
            "--vocab-only",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--parallel",
            "1",
            "--offline",
            "--no-mmproj",
            "--no-webui",
            "--api-key-file",
            str(key_file),
        ]
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=_offline_environment(),
            close_fds=True,
        )
        instance = _TokenizerInstance(
            pack_sha256,
            resolved,
            port,
            process,
            log,
            key_file,
            key,
            time.monotonic(),
        )
        deadline = time.monotonic() + settings.llama_server_start_timeout_seconds
        try:
            with httpx.Client(
                timeout=2,
                trust_env=False,
                headers={"Authorization": f"Bearer {key}"},
            ) as client:
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("llama.cpp tokenizer exited during startup")
                    try:
                        response = client.post(
                            f"http://127.0.0.1:{port}/tokenize",
                            json={"content": "ready", "with_pieces": True},
                        )
                        if response.status_code == 200:
                            return instance
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.2)
            raise RuntimeError("llama.cpp tokenizer startup timed out")
        except Exception:
            self._terminate(instance)
            raise

    @staticmethod
    def _detokenize(client: httpx.Client, token_ids: list[int]) -> str:
        response = client.post("/detokenize", json={"tokens": token_ids})
        if response.status_code >= 400:
            raise ValueError("llama.cpp rejected the token IDs")
        content = response.json().get("content")
        if not isinstance(content, str):
            raise RuntimeError("llama.cpp returned an invalid detokenization result")
        return content

    @staticmethod
    def _pieces(
        raw_pieces: list[str | list[int]],
        token_ids: list[int],
        special_token_ids: set[int],
        text: str,
    ) -> tuple[list[dict[str, Any]], bool]:
        input_bytes = text.encode("utf-8")
        piece_bytes_list = [
            raw_piece.encode("utf-8") if isinstance(raw_piece, str) else bytes(raw_piece)
            for raw_piece in raw_pieces
        ]
        offsets_verified = (
            b"".join(
                piece_bytes
                for token_id, piece_bytes in zip(token_ids, piece_bytes_list, strict=True)
                if token_id not in special_token_ids
            )
            == input_bytes
        )
        byte_cursor = 0
        pieces: list[dict[str, Any]] = []
        for token_id, raw_piece, piece_bytes in zip(
            token_ids,
            raw_pieces,
            piece_bytes_list,
            strict=True,
        ):
            special = token_id in special_token_ids
            byte_start = byte_cursor if offsets_verified else None
            if offsets_verified and not special:
                byte_cursor += len(piece_bytes)
            byte_end = byte_cursor if offsets_verified else None
            character_start = LlamaTokenizerPool._character_offset(input_bytes, byte_start)
            character_end = LlamaTokenizerPool._character_offset(input_bytes, byte_end)
            rendered = (
                raw_piece
                if isinstance(raw_piece, str)
                else "".join(f"\\x{value:02x}" for value in raw_piece)
            )
            pieces.append(
                {
                    "id": token_id,
                    "token": rendered,
                    "piece": rendered,
                    "piece_bytes": list(piece_bytes),
                    "special": special,
                    "character_start": character_start,
                    "character_end": character_end,
                    "byte_start": byte_start,
                    "byte_end": byte_end,
                }
            )
        return pieces, offsets_verified

    @staticmethod
    def _character_offset(input_bytes: bytes, byte_offset: int | None) -> int | None:
        if byte_offset is None:
            return None
        try:
            return len(input_bytes[:byte_offset].decode("utf-8"))
        except UnicodeDecodeError:
            # A byte-level token can end inside one Unicode scalar. The byte
            # position remains exact, but no false character boundary is emitted.
            return None

    def _stop_locked(self) -> None:
        instance = self._instance
        self._instance = None
        if instance is not None:
            self._terminate(instance)

    @staticmethod
    def _terminate(instance: _TokenizerInstance) -> None:
        if instance.process.poll() is None:
            instance.process.terminate()
            try:
                instance.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                instance.process.kill()
                instance.process.wait(timeout=5)
        instance.log.close()
        instance.key_file.unlink(missing_ok=True)

    @staticmethod
    def _available_port() -> int:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])
