from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

SUPPORTED_MODEL_TYPES = {
    "deepseek_v2",
    "deepseek_v3",
    "deepseek_v32",
    "glm4_moe",
    "glm_moe_dsa",
    "kimi_k2",
    "minimax_m2",
    "minimax_m3",
    "mixtral",
    "qwen2_moe",
    "qwen3_moe",
    "qwen3_next",
}


def checked_model(path: str) -> Path:
    requested = Path(path).expanduser()
    if requested.is_symlink():
        raise ValueError("Model path must not be a symlink")
    model = requested.resolve(strict=True)
    if not model.is_dir():
        raise ValueError("Model path must be a regular local directory")
    for item in model.rglob("*"):
        if item.is_symlink() or (not item.is_file() and not item.is_dir()):
            raise ValueError("Model directory must contain only regular files and directories")
    config_path = model / "config.json"
    if config_path.is_symlink() or not config_path.is_file():
        raise ValueError("A regular config.json is required")
    if config_path.stat().st_size > 1024 * 1024:
        raise ValueError("config.json exceeds 1 MiB")
    config = json.loads(config_path.read_text())
    if not isinstance(config, dict):
        raise ValueError("config.json must contain an object")
    if any(config.get(key) for key in ("auto_map", "custom_pipelines", "model_file")):
        raise ValueError("Super ii will not enable model-supplied Python code")
    model_type = str(config.get("model_type", "")).lower()
    if model_type not in SUPPORTED_MODEL_TYPES:
        raise ValueError(f"No reviewed KTransformers profile for model_type={model_type or 'unknown'}")
    if not any(item.is_file() and not item.is_symlink() for item in model.glob("*.safetensors")):
        raise ValueError("A local Safetensors model directory is required")
    return model


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fail-closed Super ii preflight for a KTransformers CPU+GPU plan"
    )
    parser.add_argument("action", choices=("check", "plan"))
    parser.add_argument("model_directory")
    args = parser.parse_args()
    model = checked_model(args.model_directory)
    kt = shutil.which("kt")
    if not kt:
        raise RuntimeError("Install the pinned KTransformers environment before continuing")
    subprocess.run([kt, "doctor"], check=True)
    if args.action == "check":
        print(f"Super ii accepted the local {model.name} files for KTransformers planning.")
        return
    subprocess.run(
        [
            kt,
            "run",
            str(model),
            "--model-path",
            str(model),
            "--host",
            "127.0.0.1",
            "--port",
            "30000",
            "--dry-run",
        ],
        check=True,
    )
    print(
        "Planning only: review the emitted command against the official guide for this exact "
        "model and keep the eventual server on 127.0.0.1."
    )


if __name__ == "__main__":
    main()
