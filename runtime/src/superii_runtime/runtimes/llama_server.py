from __future__ import annotations

import atexit
import os
import shutil
import socket
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO
from uuid import UUID

import httpx

from ..database import RepositoryDatabase
from ..settings import Settings
from .llama_cpp import _offline_environment


@dataclass(slots=True)
class _Instance:
    repository_id: UUID
    revision_id: UUID
    model_path: str
    model_sha256: str
    model: Path
    port: int
    process: subprocess.Popen[bytes]
    log: BinaryIO
    started_at: float
    last_used_at: float
    active_requests: int = 0


class LlamaServerPool:
    """Keep one loopback-only llama-server loaded and reuse it between requests."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._instance: _Instance | None = None
        self._idle_timer: threading.Timer | None = None
        atexit.register(self.close)

    @contextmanager
    def lease(
        self,
        *,
        repository_id: UUID,
        revision_id: UUID,
        model_path: str,
        model_sha256: str,
        model: Path,
        settings: Settings,
        database: RepositoryDatabase,
    ) -> Iterator[_Instance]:
        with self._condition:
            self._expire_idle_locked(settings, database)
            self._cancel_idle_locked()
            while (
                self._instance is not None
                and self._instance.active_requests > 0
                and not self._same(self._instance, revision_id, model_path, model_sha256)
            ):
                self._condition.wait(timeout=5)
            if self._instance is not None and not self._same(
                self._instance, revision_id, model_path, model_sha256
            ):
                self._stop_locked(database)
            if self._instance is None or self._instance.process.poll() is not None:
                if self._instance is not None:
                    self._stop_locked(database, failure_code="server_exited")
                self._instance = self._start(
                    repository_id=repository_id,
                    revision_id=revision_id,
                    model_path=model_path,
                    model_sha256=model_sha256,
                    model=model,
                    settings=settings,
                    database=database,
                )
            instance = self._instance
            instance.active_requests += 1
            instance.last_used_at = time.monotonic()
        try:
            yield instance
        finally:
            with self._condition:
                instance.active_requests = max(0, instance.active_requests - 1)
                instance.last_used_at = time.monotonic()
                if self._instance is instance and instance.active_requests == 0:
                    self._schedule_idle_locked(settings, database)
                self._condition.notify_all()

    def generate(
        self,
        *,
        repository_id: UUID,
        revision_id: UUID,
        model_path: str,
        model_sha256: str,
        model: Path,
        settings: Settings,
        database: RepositoryDatabase,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
        max_tokens: int,
        temperature: float,
        top_p: float,
        seed: int,
    ) -> dict[str, Any]:
        with self.lease(
            repository_id=repository_id,
            revision_id=revision_id,
            model_path=model_path,
            model_sha256=model_sha256,
            model=model,
            settings=settings,
            database=database,
        ) as instance:
            client = httpx.Client(
                base_url=f"http://127.0.0.1:{instance.port}",
                timeout=settings.command_timeout_seconds,
            )
            try:
                if messages is not None:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "messages": messages,
                            "max_tokens": max_tokens,
                            "temperature": temperature,
                            "top_p": top_p,
                            "seed": seed,
                            "stream": False,
                        },
                    )
                else:
                    response = client.post(
                        "/completion",
                        json={
                            "prompt": prompt,
                            "n_predict": max_tokens,
                            "temperature": temperature,
                            "top_p": top_p,
                            "seed": seed,
                            "stream": False,
                        },
                    )
                if response.status_code >= 500:
                    raise RuntimeError("persistent llama.cpp server failed")
                if response.status_code >= 400:
                    raise ValueError("llama.cpp rejected the generation request")
                payload = response.json()
            finally:
                client.close()

            if messages is not None:
                choices = payload.get("choices")
                if not isinstance(choices, list) or not choices:
                    raise RuntimeError("llama.cpp chat response is invalid")
                message = choices[0].get("message") if isinstance(choices[0], dict) else None
                text = message.get("content") if isinstance(message, dict) else None
            else:
                text = payload.get("content")
            if not isinstance(text, str):
                raise RuntimeError("llama.cpp response omitted generated text")
            database.record_model_request(
                revision_id, model_path, settings.llama_server_idle_seconds
            )
            return {
                "text": text,
                "model": model.name,
                "model_sha256": model_sha256,
                "max_tokens": max_tokens,
                "runtime": "llama.cpp-server",
                "persistent": True,
                "offline": True,
                "usage": payload.get("usage"),
                "timings": payload.get("timings"),
            }

    def status(self) -> dict[str, Any]:
        with self._condition:
            instance = self._instance
            if instance is None or instance.process.poll() is not None:
                return {"state": "stopped", "persistent": True, "loopback": True}
            return {
                "state": "ready" if instance.active_requests == 0 else "busy",
                "persistent": True,
                "loopback": True,
                "repository_id": str(instance.repository_id),
                "revision_id": str(instance.revision_id),
                "model_path": instance.model_path,
                "model_sha256": instance.model_sha256,
                "active_requests": instance.active_requests,
                "loaded_seconds": round(time.monotonic() - instance.started_at, 3),
            }

    def unload(self, database: RepositoryDatabase, revision_id: UUID | None = None) -> bool:
        with self._condition:
            if self._instance is None:
                return False
            if revision_id is not None and self._instance.revision_id != revision_id:
                return False
            if self._instance.active_requests > 0:
                raise RuntimeError("model is serving an active request")
            self._stop_locked(database)
            return True

    def close(self) -> None:
        with self._condition:
            self._cancel_idle_locked()
            instance = self._instance
            self._instance = None
            if instance is None:
                return
            self._terminate(instance)

    def _start(
        self,
        *,
        repository_id: UUID,
        revision_id: UUID,
        model_path: str,
        model_sha256: str,
        model: Path,
        settings: Settings,
        database: RepositoryDatabase,
    ) -> _Instance:
        executable = shutil.which(settings.llama_server_command)
        if executable is None:
            raise RuntimeError("llama.cpp server is unavailable")
        resolved = model.resolve(strict=True)
        if resolved.is_symlink() or not resolved.is_file() or resolved.suffix.lower() != ".gguf":
            raise ValueError("persistent llama.cpp accepts only a local GGUF file")
        port = self._available_port()
        log_root = settings.storage_root / "runtime" / "llama"
        log_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        log_path = log_root / f"{revision_id}-{model_sha256[:12]}.log"
        log = log_path.open("wb")
        os.chmod(log_path, 0o640)
        command = [
            executable,
            "--model",
            str(resolved),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--ctx-size",
            str(settings.llama_server_context_size),
            "--parallel",
            str(settings.llama_server_parallel),
            "--cont-batching",
            "--no-webui",
        ]
        started_at = time.monotonic()
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=_offline_environment(),
            close_fds=True,
        )
        instance = _Instance(
            repository_id,
            revision_id,
            model_path,
            model_sha256,
            resolved,
            port,
            process,
            log,
            started_at,
            started_at,
        )
        database.record_model_instance(
            repository_id,
            revision_id,
            model_path,
            model_sha256,
            "starting",
            f"loopback:{port}",
            idle_seconds=settings.llama_server_idle_seconds,
            metadata={"parallel": settings.llama_server_parallel, "network": "loopback_only"},
        )
        deadline = time.monotonic() + settings.llama_server_start_timeout_seconds
        try:
            with httpx.Client(timeout=2) as client:
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("llama.cpp server exited during startup")
                    try:
                        if client.get(f"http://127.0.0.1:{port}/health").status_code == 200:
                            cold_start_ms = round((time.monotonic() - started_at) * 1000)
                            database.record_model_instance(
                                repository_id,
                                revision_id,
                                model_path,
                                model_sha256,
                                "ready",
                                f"loopback:{port}",
                                idle_seconds=settings.llama_server_idle_seconds,
                                cold_start_ms=cold_start_ms,
                                metadata={
                                    "parallel": settings.llama_server_parallel,
                                    "continuous_batching": True,
                                    "network": "loopback_only",
                                },
                            )
                            return instance
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.25)
            raise RuntimeError("llama.cpp server startup timed out")
        except Exception:
            self._terminate(instance)
            database.record_model_instance(
                repository_id,
                revision_id,
                model_path,
                model_sha256,
                "failed",
                None,
                idle_seconds=settings.llama_server_idle_seconds,
                failure_code="startup_failed",
            )
            raise

    def _expire_idle_locked(self, settings: Settings, database: RepositoryDatabase) -> None:
        instance = self._instance
        if (
            instance is not None
            and instance.active_requests == 0
            and time.monotonic() - instance.last_used_at >= settings.llama_server_idle_seconds
        ):
            self._stop_locked(database)

    def _stop_locked(self, database: RepositoryDatabase, failure_code: str | None = None) -> None:
        self._cancel_idle_locked()
        instance = self._instance
        self._instance = None
        if instance is None:
            return
        self._terminate(instance)
        database.stop_model_instance(
            instance.revision_id, instance.model_path, failure_code=failure_code
        )

    def _schedule_idle_locked(self, settings: Settings, database: RepositoryDatabase) -> None:
        self._cancel_idle_locked()
        instance = self._instance
        if instance is None or instance.active_requests > 0:
            return
        elapsed = time.monotonic() - instance.last_used_at
        delay = max(0.1, settings.llama_server_idle_seconds - elapsed)
        timer = threading.Timer(
            delay,
            self._expire_scheduled,
            args=(settings, database, instance.revision_id, instance.model_sha256),
        )
        timer.daemon = True
        self._idle_timer = timer
        timer.start()

    def _expire_scheduled(
        self,
        settings: Settings,
        database: RepositoryDatabase,
        revision_id: UUID,
        model_sha256: str,
    ) -> None:
        with self._condition:
            self._idle_timer = None
            instance = self._instance
            if (
                instance is None
                or instance.revision_id != revision_id
                or instance.model_sha256 != model_sha256
                or instance.active_requests > 0
            ):
                return
            if time.monotonic() - instance.last_used_at >= settings.llama_server_idle_seconds:
                self._stop_locked(database)
            else:
                self._schedule_idle_locked(settings, database)

    def _cancel_idle_locked(self) -> None:
        timer = self._idle_timer
        self._idle_timer = None
        if timer is not None:
            timer.cancel()

    @staticmethod
    def _terminate(instance: _Instance) -> None:
        if instance.process.poll() is None:
            instance.process.terminate()
            try:
                instance.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                instance.process.kill()
                instance.process.wait(timeout=5)
        instance.log.close()

    @staticmethod
    def _same(instance: _Instance, revision_id: UUID, path: str, sha256: str) -> bool:
        return (
            instance.revision_id == revision_id
            and instance.model_path == path
            and instance.model_sha256 == sha256
            and instance.process.poll() is None
        )

    @staticmethod
    def _available_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])
