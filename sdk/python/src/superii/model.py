from __future__ import annotations

import json
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx

from .client import Snapshot
from .errors import IntegrityError, PlanError, SuperiiError
from .hardware import hardware
from .planner import ARCHITECTURES, Plan


def check_config(snapshot: Snapshot) -> None:
    for name in ("config.json", "tokenizer_config.json", "generation_config.json"):
        file = snapshot.path / name
        if not file.exists():
            continue
        if file.stat().st_size > 4 * 1024**2:
            raise IntegrityError("Configuration exceeds 4 MiB")
        config = json.loads(file.read_text())
        if any(config.get(k) for k in ("auto_map", "custom_pipelines", "model_file")):
            raise IntegrityError("Custom repository code is not supported by secure loading")
        if name == "config.json" and config.get("model_type") not in ARCHITECTURES:
            raise IntegrityError("Architecture is not in the built-in loader allowlist")
    for index in snapshot.path.glob("*.safetensors.index.json"):
        if index.stat().st_size > 4 * 1024**2:
            raise IntegrityError("Weight index exceeds 4 MiB")
        for value in json.loads(index.read_text()).get("weight_map", {}).values():
            if value not in snapshot.files or not value.endswith(".safetensors"):
                raise IntegrityError("Weight index points outside the verified snapshot")


class Model:
    def __init__(self, snapshot: Snapshot, selected: Plan, *, lazy_weights: bool = False):
        if (
            snapshot.manifest.revision != selected.revision
            or snapshot.manifest.manifest_sha256 != selected.manifest_sha256
            or set(snapshot.files) != set(selected.files)
        ):
            raise IntegrityError("Execution plan and snapshot do not match")
        snapshot.verify()
        machine = hardware()
        budget = int(machine.available_ram_bytes * 0.85)
        if selected.accelerator in {"cuda", "rocm"}:
            budget = min(budget, int(machine.available_vram_bytes * 0.85))
        if selected.estimated_memory_bytes > budget:
            raise PlanError("Memory availability changed. Free memory or create a smaller plan.")
        self.snapshot, self.plan = snapshot, selected
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._temporary: tempfile.TemporaryDirectory | None = None
        self._http: httpx.Client | None = None
        self._closed = False
        self._model = self._tokenizer = None
        if selected.runtime == "llama.cpp":
            self._start_llama()
        else:
            check_config(snapshot)
            # These documented offline modes prevent implicit registry downloads.
            # They are not an OS network sandbox for arbitrary user Python.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
            os.environ["VLLM_NO_USAGE_STATS"] = "1"
            path = str(snapshot.path)
            if selected.runtime == "mlx":
                from mlx_lm import load

                self._model, self._tokenizer = load(
                    path,
                    tokenizer_config={"trust_remote_code": False, "local_files_only": True},
                    trust_remote_code=False,
                    lazy=lazy_weights,
                )
            elif selected.runtime == "transformers":
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer

                self._tokenizer = AutoTokenizer.from_pretrained(
                    path,
                    local_files_only=True,
                    trust_remote_code=False,
                )
                self._model = AutoModelForCausalLM.from_pretrained(
                    path,
                    local_files_only=True,
                    trust_remote_code=False,
                    use_safetensors=True,
                    dtype=torch.float32 if selected.accelerator == "cpu" else "auto",
                    device_map="cpu" if selected.accelerator == "cpu" else {"": "cuda:0"},
                ).eval()
            elif selected.runtime == "vllm":
                from vllm import LLM

                self._model = LLM(
                    model=path,
                    tokenizer=path,
                    trust_remote_code=False,
                    load_format="safetensors",
                    max_model_len=selected.context_size,
                    gpu_memory_utilization=0.75,
                    enforce_eager=True,
                )
                self._tokenizer = self._model.get_tokenizer()
            else:
                raise PlanError("Unsupported execution adapter")

    def _start_llama(self) -> None:
        executable = shutil.which("llama-server")
        if not executable:
            raise PlanError("llama-server is not installed")
        help_text = subprocess.run(
            [executable, "--help"], capture_output=True, text=True, timeout=10, check=True
        ).stdout
        for flag in ("--offline", "--api-key-file", "--no-webui", "--no-mmproj"):
            if flag not in help_text:
                raise PlanError(f"Update llama.cpp: this build lacks required {flag}")
        self._temporary = tempfile.TemporaryDirectory(prefix="superii-inference-")
        key = secrets.token_urlsafe(32)
        key_file = Path(self._temporary.name) / "key"
        key_file.write_text(key)
        key_file.chmod(0o600)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = {
            k: v
            for k, v in os.environ.items()
            if k in {"PATH", "HOME", "TMPDIR", "SYSTEMROOT", "WINDIR", "LANG"}
        }
        environment.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
        command = [
            executable,
            "--model",
            str(self.snapshot.path / self.plan.primary_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--offline",
            "--no-webui",
            "--no-mmproj",
            "--api-key-file",
            str(key_file),
            "--ctx-size",
            str(self.plan.context_size),
            "--parallel",
            "1",
            "--gpu-layers",
            str(self.plan.gpu_layers),
        ]
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        self._http = httpx.Client(
            base_url=f"http://127.0.0.1:{port}",
            timeout=300,
            trust_env=False,
            headers={"Authorization": f"Bearer {key}"},
        )
        deadline = time.monotonic() + 180
        try:
            while time.monotonic() < deadline:
                if self._process.poll() is not None:
                    raise SuperiiError(
                        "llama.cpp could not load this model. Check compatibility "
                        "and available memory; no larger fallback was attempted."
                    )
                try:
                    # Authenticated endpoint proves we reached our instance, not a port race.
                    if self._http.post("/tokenize", json={"content": "ready"}).is_success:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
            raise SuperiiError("Local inference startup timed out")
        except Exception:
            self.close()
            raise

    def count_tokens(self, text: str) -> int:
        if self._http:
            response = self._http.post("/tokenize", json={"content": text})
            response.raise_for_status()
            return len(response.json()["tokens"])
        return len(self._tokenizer.encode(text))

    def stream(
        self, prompt: str, *, max_tokens: int = 256, temperature: float = 0.0
    ) -> Iterator[str]:
        if self._closed:
            raise SuperiiError("Model is closed")
        if not isinstance(prompt, str) or not 1 <= max_tokens <= 8192 or not 0 <= temperature <= 2:
            raise ValueError("Prompt must be text; max_tokens 1–8192; temperature 0–2")
        if len(prompt.encode()) > 1024**2:
            raise ValueError("Prompt exceeds 1 MiB")
        with self._lock:
            if self.count_tokens(prompt) + max_tokens > self.plan.context_size:
                raise PlanError("Prompt plus output exceeds planned context; reduce input/output")
            if self._http:
                with self._http.stream(
                    "POST",
                    "/completion",
                    json={
                        "prompt": prompt,
                        "n_predict": max_tokens,
                        "temperature": temperature,
                        "stream": True,
                        "cache_prompt": True,
                    },
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if line.startswith("data: ") and line[6:] != "[DONE]":
                            data = json.loads(line[6:])
                            if data.get("error"):
                                raise SuperiiError("Local inference failed")
                            if data.get("content"):
                                yield data["content"]
            elif self.plan.runtime == "mlx":
                from mlx_lm import stream_generate
                from mlx_lm.sample_utils import make_sampler

                for result in stream_generate(
                    self._model,
                    self._tokenizer,
                    prompt=prompt,
                    max_tokens=max_tokens,
                    sampler=make_sampler(temp=temperature),
                ):
                    if result.text:
                        yield result.text
            elif self.plan.runtime == "vllm":
                from vllm import SamplingParams

                result = self._model.generate(
                    [prompt],
                    SamplingParams(max_tokens=max_tokens, temperature=temperature),
                    use_tqdm=False,
                )
                # The synchronous offline vLLM adapter returns a complete response.
                yield result[0].outputs[0].text
            else:
                import torch

                inputs = self._tokenizer(prompt, return_tensors="pt").to(self._model.device)
                with torch.inference_mode():
                    result = self._model.generate(
                        **inputs,
                        max_new_tokens=max_tokens,
                        do_sample=temperature > 0,
                        **({"temperature": temperature} if temperature > 0 else {}),
                    )
                yield self._tokenizer.decode(
                    result[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
                )

    def chat(
        self, messages: list[dict[str, str]], *, max_tokens: int = 256, temperature: float = 0.0
    ) -> str:
        if not self._http:
            prompt = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            return self.generate(prompt, max_tokens=max_tokens, temperature=temperature)
        if self._closed or not 1 <= max_tokens <= 8192 or not 0 <= temperature <= 2:
            raise ValueError("Invalid generation parameters or closed model")
        with self._lock:
            if (
                self.count_tokens("\n".join(m["content"] for m in messages)) + max_tokens + 256
                > self.plan.context_size
            ):
                raise PlanError("Messages and output exceed planned context")
            response = self._http.post(
                "/v1/chat/completions",
                json={
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

    def generate(self, prompt: str, *, max_tokens: int = 256, temperature: float = 0.0) -> str:
        return "".join(self.stream(prompt, max_tokens=max_tokens, temperature=temperature))

    def serve(self, *, port: int = 8765, token: str) -> None:
        from .serving import serve

        serve(self, port=port, token=token)

    def serve_mcp(self) -> None:
        from .serving import serve_mcp

        serve_mcp(self)

    def close(self) -> None:
        self._closed = True
        if self._http:
            self._http.close()
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        if self._temporary:
            self._temporary.cleanup()
        self._model = self._tokenizer = None

    def __enter__(self) -> Model:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
