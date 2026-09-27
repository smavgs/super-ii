from __future__ import annotations

import gc
import hashlib
import importlib.metadata
import json
import math
import shutil
import subprocess
from pathlib import Path

from superii import Client
from superii.errors import IntegrityError
from superii.recipes import Recipe, RunRecord
from superii.recipes.contracts import canonical
from superii.recipes.training import training_plan, training_rows

SOUP_VERSION = "0.75.1"
SOUP_PROJECT = Path("soup")
WORK_DIRECTORY = Path(".superii/soup")
OUTPUT_DIRECTORY = Path("adapter")
SAFE_OUTPUT_SUFFIXES = {
    ".json",
    ".jinja",
    ".md",
    ".model",
    ".safetensors",
    ".tiktoken",
    ".txt",
}


def _run(argv: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        check=True,
        capture_output=capture,
        text=True,
    )


def _isolated_soup_version(uv: str) -> str:
    result = _run(
        [
            uv,
            "run",
            "--project",
            str(SOUP_PROJECT),
            "--frozen",
            "python",
            "-c",
            "import importlib.metadata; print(importlib.metadata.version('soup-cli'))",
        ],
        capture=True,
    )
    version = result.stdout.strip()
    if version != SOUP_VERSION:
        raise IntegrityError(f"Expected Soup {SOUP_VERSION}, found {version or 'unknown'}")
    return version


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_bytes(b"".join(canonical(row) + b"\n" for row in rows))
    path.chmod(0o600)


def _held_out_loss(
    source: Path,
    rows: list[dict],
    *,
    sequence_length: int,
    adapter: Path | None = None,
) -> tuple[float, int]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        source,
        local_files_only=True,
        trust_remote_code=False,
    )
    if tokenizer.pad_token_id is None:
        if tokenizer.eos_token_id is None:
            raise ValueError("The tokenizer needs a defined padding or EOS token")
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        source,
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=True,
        dtype=torch.float32,
    )
    if adapter is not None:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter, local_files_only=True)
    model.eval()
    losses: list[float] = []
    generated_tokens = 0
    try:
        with torch.no_grad():
            for row in rows:
                encoded = tokenizer(
                    row["text"],
                    return_tensors="pt",
                    truncation=True,
                    max_length=sequence_length,
                )
                if encoded["input_ids"].shape[-1] < 2:
                    continue
                loss = float(model(**encoded, labels=encoded["input_ids"]).loss)
                if not math.isfinite(loss):
                    raise ValueError("Held-out loss is not finite")
                losses.append(loss)
            if not losses:
                raise ValueError("Held-out examples need at least two tokens after tokenization")
            prompt = tokenizer(
                rows[0]["text"],
                return_tensors="pt",
                truncation=True,
                max_length=max(2, sequence_length - 1),
            )
            generated = model.generate(
                **prompt,
                do_sample=False,
                max_new_tokens=1,
                pad_token_id=tokenizer.pad_token_id,
            )
            generated_tokens = int(generated.shape[-1] - prompt["input_ids"].shape[-1])
    finally:
        del model
        gc.collect()
    return sum(losses) / len(losses), generated_tokens


def _sanitize_adapter(recipe: Recipe, soup_version: str, config_sha256: str) -> dict[str, Path]:
    if not OUTPUT_DIRECTORY.is_dir() or OUTPUT_DIRECTORY.is_symlink():
        raise IntegrityError("Soup did not produce a regular adapter directory")
    transient_names = {
        "training_args.bin",
        "optimizer.pt",
        "scheduler.pt",
        "rng_state.pth",
        "scaler.pt",
    }
    initial_entries = list(OUTPUT_DIRECTORY.rglob("*"))
    for item in initial_entries:
        if item.is_symlink():
            relative = item.relative_to(OUTPUT_DIRECTORY).as_posix()
            raise IntegrityError(f"Unsafe Soup adapter symlink: {relative}")
        if not item.is_file() and not item.is_dir():
            relative = item.relative_to(OUTPUT_DIRECTORY).as_posix()
            raise IntegrityError(f"Unsafe Soup adapter entry: {relative}")
    for transient in initial_entries:
        if transient.name not in transient_names:
            continue
        if not transient.is_file():
            raise IntegrityError(f"Unsafe transient training output: {transient.name}")
        transient.unlink()
    files = [item for item in OUTPUT_DIRECTORY.rglob("*") if item.is_file()]
    if len(files) > 200:
        raise IntegrityError("Soup adapter output exceeds the 200-file safety limit")
    for item in files:
        if item.is_symlink() or item.suffix.lower() not in SAFE_OUTPUT_SUFFIXES:
            relative = item.relative_to(OUTPUT_DIRECTORY).as_posix()
            raise IntegrityError(f"Unsafe Soup adapter output: {relative}")
    required = {
        OUTPUT_DIRECTORY / "adapter_config.json",
        OUTPUT_DIRECTORY / "adapter_model.safetensors",
    }
    if not required <= set(files):
        raise IntegrityError("Soup did not produce the required safe LoRA adapter files")
    adapter_config = OUTPUT_DIRECTORY / "adapter_config.json"
    if adapter_config.stat().st_size > 1024**2:
        raise IntegrityError("Adapter configuration exceeds 1 MiB")
    settings = json.loads(adapter_config.read_text())
    if not isinstance(settings, dict):
        raise IntegrityError("Adapter configuration must be an object")
    settings["base_model_name_or_path"] = recipe.document["inputs"]["generator"]["repository"]
    settings["inference_mode"] = True
    adapter_config.write_bytes(canonical(settings) + b"\n")
    lineage = {
        "relationship": "adapter-for",
        "base": recipe.document["inputs"]["generator"],
        "dataset": recipe.document["inputs"]["dataset"],
        "recipe_sha256": recipe.sha256,
        "engine": {"name": "soup", "version": soup_version, "config_sha256": config_sha256},
        "evaluation": "held-out loss and one-token reload probe; not a task-quality benchmark",
    }
    (OUTPUT_DIRECTORY / "superii-lineage.json").write_bytes(canonical(lineage) + b"\n")
    (OUTPUT_DIRECTORY / "superii-engine.json").write_bytes(
        canonical(
            {
                "engine": "soup",
                "version": soup_version,
                "config_sha256": config_sha256,
                "recipe_sha256": recipe.sha256,
                "isolated_environment": True,
                "arbitrary_model_code": False,
            }
        )
        + b"\n"
    )
    (OUTPUT_DIRECTORY / "README.md").write_text(
        "# Super ii LoRA adapter\n\n"
        f"Base: {recipe.document['inputs']['generator']['repository']}\n"
        f"Revision: {recipe.document['inputs']['generator']['revision']}\n"
        f"Training engine: Soup {soup_version} in a separate frozen environment\n\n"
        "Super ii reloaded this adapter onto the exact checksum-verified base and ran "
        "held-out loss plus a bounded inference probe. These are execution checks, not a "
        "claim that the model improved on your real task.\n"
    )
    return {
        item.relative_to(OUTPUT_DIRECTORY).as_posix(): item
        for item in OUTPUT_DIRECTORY.rglob("*")
        if item.is_file()
    }


def train_with_soup(
    recipe: Recipe,
    client: Client,
    *,
    run_directory: Path = Path("runs"),
) -> Path:
    engine = recipe.document["dependencies"].get("training-engine")
    if recipe.document["outcome"] != "sft" or engine != f"soup@{SOUP_VERSION}":
        raise ValueError("Select an SFT recipe with the Soup training engine")
    try:
        training_epochs = int(recipe.document["dependencies"]["training-epochs"])
    except (KeyError, TypeError, ValueError) as error:
        raise IntegrityError("The recipe has no valid training-pass count") from error
    if not 1 <= training_epochs <= 100:
        raise IntegrityError("Training passes must be between 1 and 100")
    if recipe.document["target"]["accelerator"] != "cpu":
        raise ValueError("This verified Soup path currently requires the CPU target")
    if OUTPUT_DIRECTORY.exists() or WORK_DIRECTORY.exists():
        raise ValueError("Use a new project directory for a new training run")
    uv = shutil.which("uv")
    if not uv:
        raise RuntimeError("Install uv before running this generated project")
    run = RunRecord(recipe, "train", directory=run_directory)
    try:
        soup_version = _isolated_soup_version(uv)
        source = recipe.acquire("generator", client)
        dataset = recipe.acquire("dataset", client)
        source.verify()
        planned = training_plan(recipe, source)
        training, evaluation = training_rows(dataset, seed=recipe.config["seed"])
        WORK_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=False)
        train_file = WORK_DIRECTORY / "train.jsonl"
        held_out_file = WORK_DIRECTORY / "held-out.jsonl"
        _write_jsonl(
            train_file,
            [
                {"instruction": "", "input": "", "output": row["text"]}
                for row in training
            ],
        )
        _write_jsonl(held_out_file, evaluation)
        before, _ = _held_out_loss(
            source.path,
            evaluation,
            sequence_length=recipe.config["sequence_length"],
        )
        soup_config = {
            "base": str(source.path.resolve()),
            "task": "sft",
            "backend": "transformers",
            "data": {
                "train": train_file.as_posix(),
                "format": "alpaca",
                "chat_template": "chatml",
                "val_split": 0.0,
                "max_length": recipe.config["sequence_length"],
                "train_on_responses_only": False,
            },
            "training": {
                "epochs": training_epochs,
                "lr": recipe.config["learning_rate"],
                "batch_size": recipe.config["batch_size"],
                "gradient_accumulation_steps": recipe.config["gradient_accumulation_steps"],
                "seed": recipe.config["seed"],
                "data_seed": recipe.config["seed"],
                "quantization": "none",
                "scheduler": "linear",
                "warmup_ratio": 0.0,
                "weight_decay": 0.0,
                "logging_steps": 1,
                "save_steps": 1_000_000,
                "lora": {
                    "r": recipe.config["lora_rank"],
                    "alpha": recipe.config["lora_rank"] * 2,
                    "dropout": 0.05,
                    "target_modules": "auto",
                },
            },
            "output": OUTPUT_DIRECTORY.as_posix(),
        }
        config_bytes = canonical(soup_config) + b"\n"
        config_sha256 = hashlib.sha256(config_bytes).hexdigest()
        config_path = WORK_DIRECTORY / "soup.json"
        config_path.write_bytes(config_bytes)
        config_path.chmod(0o600)
        prefix = [
            uv,
            "run",
            "--project",
            str(SOUP_PROJECT),
            "--frozen",
            "soup",
            "train",
            "--config",
            str(config_path),
            "--yes",
        ]
        _run([*prefix, "--dry-run"])
        _run(prefix)
        artifacts = _sanitize_adapter(recipe, soup_version, config_sha256)
        after, generated_tokens = _held_out_loss(
            source.path,
            evaluation,
            sequence_length=recipe.config["sequence_length"],
            adapter=OUTPUT_DIRECTORY,
        )
        return run.finish(
            metrics={
                **planned,
                "engine": "soup",
                "engine_version": soup_version,
                "engine_config_sha256": config_sha256,
                "train_rows": len(training),
                "held_out_rows": len(evaluation),
                "training_epochs": training_epochs,
                "initial_eval_loss": before,
                "final_eval_loss": after,
                "verified_reload": True,
                "reload_probe_generated_tokens": generated_tokens,
                "model_quality_claim": False,
            },
            artifacts=artifacts,
        )
    except Exception as error:
        run.finish(error=type(error).__name__ + ": training failed; inspect the local error")
        raise


if __name__ == "__main__":
    if importlib.metadata.version("superii-sdk") != "0.3.0":
        raise RuntimeError("This project requires the frozen superii-sdk 0.3.0 environment")
    with Client() as api:
        print(train_with_soup(Recipe.read(), api))
