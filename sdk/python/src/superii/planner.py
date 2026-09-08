from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import PlanError
from .hardware import Hardware
from .manifest import Manifest

GIB = 1024**3
POLICY = "superii-sdk-plan-v1"
ARCHITECTURES = frozenset(
    {
        "llama",
        "mistral",
        "qwen2",
        "qwen3",
        "gemma",
        "gemma2",
        "gemma3_text",
        "phi3",
        "gpt2",
        "gpt_neox",
        "opt",
        "falcon",
        "stablelm",
        "olmo",
        "olmo2",
    }
)


@dataclass(frozen=True)
class Plan:
    repository: str
    revision: str
    manifest_sha256: str
    runtime: str
    files: tuple[str, ...]
    primary_file: str
    context_size: int
    estimated_memory_bytes: int
    memory_budget_bytes: int
    accelerator: str
    gpu_layers: int
    reasons: tuple[str, ...]
    warnings: tuple[str, ...]
    policy: str = POLICY


def plan(
    manifest: Manifest,
    machine: Hardware,
    *,
    runtime: str | None = None,
    context_size: int = 4096,
    memory_fraction: float = 0.75,
) -> Plan:
    if manifest.kind != "model":
        raise PlanError("Inference planning requires a model repository")
    if not 512 <= context_size <= 131072 or not 0.1 <= memory_fraction <= 0.85:
        raise PlanError("Context must be 512–131072; memory fraction must be 0.1–0.85")
    budget = int(machine.available_ram_bytes * memory_fraction)
    gpu_budget = int(machine.available_vram_bytes * memory_fraction)
    installed = set(machine.runtimes)
    if runtime and runtime not in installed:
        raise PlanError(f"Install the {runtime} runtime in this environment before selecting it")
    # Reserve activation/KV overhead conservatively when a measured KV profile is absent.
    overhead = max(GIB, context_size * 512 * 1024)
    reasons = (
        "Immutable weights and tokenizer are verified before loading.",
        "Memory estimate reserves OS headroom plus context and activation overhead.",
    )
    warnings = (
        "Estimated memory is not a zero-OOM guarantee; other processes can change availability.",
        "Compatibility evidence is not a performance benchmark. No automatic conversion.",
    )
    gguf = [
        f
        for f in manifest.files
        if f.path.lower().endswith(".gguf") and not re.search(r"-\d{5}-of-\d{5}\.gguf$", f.path)
    ]
    if runtime in {None, "llama.cpp"} and "llama.cpp" in installed and gguf:
        fits = [f for f in gguf if int(f.size_bytes * 1.15) + overhead <= budget]
        if fits:
            chosen = max(fits, key=lambda f: (f.size_bytes, f.path))
            needed = int(chosen.size_bytes * 1.15) + overhead
            # An installed generic llama.cpp binary doesn't prove CUDA/ROCm support.
            # Probe backend capabilities at load time; CPU fallback remains explicit.
            metal = machine.accelerator == "metal"
            return Plan(
                manifest.repository,
                manifest.revision,
                manifest.manifest_sha256,
                "llama.cpp",
                (chosen.path,),
                chosen.path,
                context_size,
                needed,
                budget,
                "metal" if metal else "cpu",
                -1 if metal else 0,
                reasons + ("Selected the largest existing GGUF variant that fits RAM.",),
                warnings
                + (
                    ("CUDA/ROCm llama.cpp offload needs a verified backend build.",)
                    if machine.accelerator in {"cuda", "rocm"}
                    else ()
                ),
            )
    weights = [f for f in manifest.files if f.path.endswith(".safetensors")]
    paths = {f.path for f in manifest.files}
    safe_files = tuple(
        f.path
        for f in manifest.files
        if f.path.endswith((".safetensors", ".json", ".model", ".txt", ".tiktoken"))
    )
    architecture = str(manifest.compatibility.get("architecture", "")).lower()
    # Loading unrecognized architecture-specific code is never an implicit fallback.
    if weights and "config.json" in paths and architecture in ARCHITECTURES:
        needed = int(sum(f.size_bytes for f in weights) * 1.2) + overhead
        is_mlx = bool(manifest.compatibility.get("mlx_compatible"))
        if (
            runtime in {None, "mlx"}
            and "mlx" in installed
            and is_mlx
            and machine.accelerator == "metal"
            and needed <= budget
        ):
            return Plan(
                manifest.repository,
                manifest.revision,
                manifest.manifest_sha256,
                "mlx",
                safe_files,
                "config.json",
                context_size,
                needed,
                budget,
                "metal",
                -1,
                reasons + ("Existing MLX-compatible safetensors on Apple unified memory.",),
                warnings,
            )
        if not is_mlx:
            for adapter in ("vllm", "transformers"):
                if runtime not in {None, adapter} or adapter not in installed:
                    continue
                gpu = machine.accelerator in {"cuda", "rocm"} and needed <= gpu_budget
                if adapter == "vllm" and not gpu:
                    continue
                # CPU uses float32: half precision weights expand while loading.
                # Unknown dtypes reserve for an 8-bit to float32 expansion.
                dtype = str(manifest.compatibility.get("dtype", "")).lower()
                cpu_factor = (
                    1.2
                    if dtype in {"float32", "f32"}
                    else (2.4 if dtype in {"float16", "bfloat16", "f16", "bf16"} else 4.8)
                )
                adapter_needed = (
                    needed
                    if gpu
                    else int(sum(f.size_bytes for f in weights) * cpu_factor) + overhead
                )
                if adapter_needed <= budget and (gpu or adapter == "transformers"):
                    return Plan(
                        manifest.repository,
                        manifest.revision,
                        manifest.manifest_sha256,
                        adapter,
                        safe_files,
                        "config.json",
                        context_size,
                        adapter_needed,
                        min(budget, gpu_budget) if gpu else budget,
                        machine.accelerator if gpu else "cpu",
                        -1 if gpu else 0,
                        reasons + ("Known built-in architecture; local safetensors only.",),
                        warnings,
                    )
    raise PlanError(
        "No installed, supported configuration fits. Install llama.cpp for GGUF or the "
        "appropriate SDK extra; select an existing smaller/quantized variant, free RAM, "
        "or reduce context. Unknown architectures and split GGUF need explicit support."
    )
