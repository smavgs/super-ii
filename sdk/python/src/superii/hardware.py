from __future__ import annotations

import platform
import shutil
import subprocess
from dataclasses import dataclass
from importlib.util import find_spec

import psutil


@dataclass(frozen=True)
class Hardware:
    os: str
    architecture: str
    accelerator: str
    ram_bytes: int
    available_ram_bytes: int
    vram_bytes: int = 0
    available_vram_bytes: int = 0
    runtimes: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()


def hardware() -> Hardware:
    """Detect locally; no hardware information is transmitted."""
    system, arch = platform.system().lower(), platform.machine().lower()
    memory = psutil.virtual_memory()
    accelerator, vram, free_vram = "cpu", 0, 0
    notes: list[str] = []
    if system == "darwin" and arch == "arm64":
        accelerator = "metal"
        notes.append("Apple unified memory is shared with the OS; RAM and VRAM are not additive.")
    elif shutil.which("nvidia-smi"):
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=memory.total,memory.free",
                    "--format=csv,noheader,nounits",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            # The initial adapters use GPU 0. Never sum memory from unrelated GPUs.
            total, available = result.stdout.splitlines()[0].split(",")
            vram, free_vram, accelerator = int(total) * 1024**2, int(available) * 1024**2, "cuda"
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            notes.append("NVIDIA memory probe failed; GPU loading is unavailable.")
    elif find_spec("torch"):
        # ROCm has no consistent cross-version CLI. Query the installed runtime.
        import torch

        if torch.version.hip and torch.cuda.is_available():
            free_vram, vram = torch.cuda.mem_get_info(0)
            accelerator = "rocm"
    runtimes = []
    if shutil.which("llama-server"):
        runtimes.append("llama.cpp")
    for module, name in (("mlx_lm", "mlx"), ("transformers", "transformers"), ("vllm", "vllm")):
        if find_spec(module):
            runtimes.append(name)
    return Hardware(
        system,
        arch,
        accelerator,
        memory.total,
        memory.available,
        vram,
        free_vram,
        tuple(runtimes),
        tuple(notes),
    )
