from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _offline_environment() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


def inspect_diffusion_model(root: Path) -> dict[str, Any]:
    _offline_environment()
    from diffusers import DiffusionPipeline

    resolved = root.resolve(strict=True)
    config = DiffusionPipeline.load_config(resolved, local_files_only=True)
    return {
        "pipeline_class": config.get("_class_name"),
        "components": sorted(key for key in config if not key.startswith("_")),
        "config": config,
        "offline": True,
    }


def generate_image(
    *,
    root: Path,
    prompt: str,
    negative_prompt: str | None,
    steps: int,
    guidance_scale: float,
    width: int,
    height: int,
    seed: int,
) -> Any:
    _offline_environment()
    import torch
    from diffusers import DiffusionPipeline

    resolved = root.resolve(strict=True)
    unsafe = [
        path.relative_to(resolved).as_posix()
        for path in resolved.rglob("*")
        if path.is_file() and path.suffix.lower() in {".bin", ".ckpt", ".pt", ".pth", ".pkl"}
    ]
    if unsafe:
        raise ValueError("diffusion repository contains an unsafe serialization format")

    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    pipeline = DiffusionPipeline.from_pretrained(
        resolved,
        local_files_only=True,
        use_safetensors=True,
        trust_remote_code=False,
    ).to(device)
    generator = torch.Generator(device=device).manual_seed(seed)
    try:
        output = pipeline(
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            width=width,
            height=height,
            generator=generator,
        )
        return output.images[0]
    finally:
        del pipeline
        if device == "cuda":
            torch.cuda.empty_cache()
