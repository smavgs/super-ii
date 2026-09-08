from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..client import Client, Snapshot
from ..errors import PlanError
from ..hardware import Hardware, hardware
from ..model import check_config
from ..planner import ARCHITECTURES
from .contracts import Recipe, RunRecord, canonical


def training_plan(recipe: Recipe, snapshot: Snapshot, machine: Hardware | None = None) -> dict:
    machine = machine or hardware()
    snapshot.verify()
    check_config(snapshot)
    configuration = json.loads((snapshot.path / "config.json").read_text())
    if (
        configuration.get("model_type") not in ARCHITECTURES
        or configuration.get("auto_map")
        or configuration.get("quantization_config")
    ):
        raise PlanError("Use a built-in, unquantized safetensors base for this SFT recipe")
    if snapshot.manifest.compatibility.get("mlx_compatible"):
        raise PlanError("This PEFT recipe needs Transformers weights, not MLX weights")
    selected = [
        f
        for f in snapshot.manifest.files
        if f.path in snapshot.files and f.path.endswith(".safetensors")
    ]
    if not selected:
        raise PlanError("SFT requires safetensors training weights")
    target = recipe.document["target"]["accelerator"]
    if target not in {"cpu", "cuda"}:
        raise PlanError("This Accelerate recipe supports CPU or a verified CUDA installation")
    if target == "cuda" and machine.accelerator != "cuda":
        raise PlanError("The recipe requires an available NVIDIA CUDA device")
    if recipe.config["adapter"] == "qlora" and target != "cuda":
        raise PlanError("This QLoRA configuration requires CUDA and bitsandbytes")
    import math

    from safetensors import safe_open

    parameters = 0
    for item in selected:
        with safe_open(snapshot.path / item.path, framework="numpy") as weights:
            for key in weights.keys():
                tensor = weights.get_slice(key)
                if tensor.get_dtype() not in {"F32", "F16", "BF16"}:
                    raise PlanError("Training requires unquantized floating point tensors")
                parameters += math.prod(tensor.get_shape())
    maximum = configuration.get("max_position_embeddings", configuration.get("n_positions"))
    if maximum and recipe.config["sequence_length"] > int(maximum):
        raise PlanError("Training sequence exceeds the base model position limit")
    hidden = int(configuration.get("hidden_size", configuration.get("n_embd", 0)))
    layers = int(configuration.get("num_hidden_layers", configuration.get("n_layer", 0)))
    if not 1 <= hidden <= 131072 or not 1 <= layers <= 1000:
        raise PlanError("Training estimates need recognized hidden size and layer count")
    base = parameters * (1.0 if recipe.config["adapter"] == "qlora" else 4)
    activations = (
        recipe.config["batch_size"] * recipe.config["sequence_length"] * hidden * layers * 32
    )
    adapters = layers * hidden * recipe.config["lora_rank"] * 128
    needed = int(base + activations + adapters + 1024**3)
    available = machine.available_vram_bytes if target == "cuda" else machine.available_ram_bytes
    budget = int(available * 0.7)
    if needed > budget:
        raise PlanError(
            "Training exceeds memory budget; reduce batch/sequence or use a smaller base"
        )
    return {
        "method": "sft",
        "adapter": recipe.config["adapter"],
        "accelerator": target,
        "estimated_memory_bytes": needed,
        "memory_budget_bytes": budget,
        "sequence_length": recipe.config["sequence_length"],
        "batch_size": recipe.config["batch_size"],
        "gradient_accumulation_steps": recipe.config["gradient_accumulation_steps"],
        "estimate_policy": "superii-training-plan-v1",
        "guarantee": "estimate, not a zero-OOM guarantee",
    }


def training_rows(snapshot: Snapshot, *, seed: int) -> tuple[list[dict], list[dict]]:
    snapshot.verify()
    rows, seen = [], set()
    total = 0
    for name in sorted(snapshot.files):
        if not name.endswith(".jsonl"):
            continue
        item = snapshot.path / name
        total += item.stat().st_size
        if total > 64 * 1024**2:
            raise ValueError("Training dataset exceeds the initial 64 MiB recipe limit")
        for line in item.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("Each training row must be an object")
            if set(row) == {"text"} and isinstance(row["text"], str):
                clean = row
            elif set(row) == {"prompt", "completion"} and all(
                isinstance(v, str) for v in row.values()
            ):
                clean = {"text": row["prompt"] + "\n" + row["completion"]}
            else:
                raise ValueError("SFT JSONL supports text or prompt/completion strings")
            if not clean["text"].strip() or len(clean["text"].encode()) > 65536:
                raise ValueError("Training text must be non-empty and bounded to 64 KiB")
            key = hashlib.sha256(clean["text"].encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            rows.append(clean)
            if len(rows) > 100_000:
                raise ValueError("Training dataset exceeds 100,000 rows")
    if len(rows) < 10:
        raise ValueError("Provide ten distinct examples for a separate held-out split")
    rows.sort(key=lambda row: hashlib.sha256(canonical([seed, row["text"]])).hexdigest())
    split = max(1, len(rows) // 10)
    return rows[split:], rows[:split]


def train(
    recipe: Recipe,
    client: Client,
    *,
    output: Path = Path("adapter"),
    run_directory: Path = Path("runs"),
) -> Path:
    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    from trl import SFTConfig, SFTTrainer

    if recipe.document["outcome"] != "sft":
        raise ValueError("Select an SFT recipe")
    if output.exists():
        raise ValueError("Use a new adapter output directory")
    run = RunRecord(recipe, "train", directory=run_directory)
    try:
        ref = recipe.document["inputs"]["generator"]
        manifest = recipe.inspect("generator", client)
        selected_bytes = sum(
            f.size_bytes
            for f in manifest.files
            if f.path in ref["files"] and f.path.endswith(".safetensors")
        )
        machine = hardware()
        target = recipe.document["target"]["accelerator"]
        if target == "cuda" and machine.accelerator != "cuda":
            raise PlanError("An available NVIDIA CUDA host is required")
        budget = machine.available_vram_bytes if target == "cuda" else machine.available_ram_bytes
        if (
            selected_bytes * (1 if recipe.config["adapter"] == "qlora" else 4) + 1024**3
            > budget * 0.7
        ):
            raise PlanError(
                "The training weights exceed the conservative download preflight budget"
            )
        source = recipe.acquire("generator", client)
        dataset = recipe.acquire("dataset", client)
        source.verify()
        planned = training_plan(recipe, source)
        training, evaluation = training_rows(dataset, seed=recipe.config["seed"])
        set_seed(recipe.config["seed"])
        tokenizer = AutoTokenizer.from_pretrained(
            source.path, local_files_only=True, trust_remote_code=False
        )
        if tokenizer.pad_token_id is None:
            if tokenizer.eos_token_id is None:
                raise ValueError("The tokenizer needs a defined padding or EOS token")
            tokenizer.pad_token = tokenizer.eos_token
        kwargs = {
            "local_files_only": True,
            "trust_remote_code": False,
            "use_safetensors": True,
            "dtype": torch.float32,
        }
        if recipe.config["adapter"] == "qlora":
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float32
            )
        model = AutoModelForCausalLM.from_pretrained(source.path, **kwargs)
        config = SFTConfig(
            output_dir=str(output),
            max_steps=recipe.config["max_steps"],
            per_device_train_batch_size=recipe.config["batch_size"],
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=recipe.config["gradient_accumulation_steps"],
            learning_rate=recipe.config["learning_rate"],
            max_length=recipe.config["sequence_length"],
            seed=recipe.config["seed"],
            data_seed=recipe.config["seed"],
            use_cpu=planned["accelerator"] == "cpu",
            bf16=False,
            fp16=False,
            gradient_checkpointing=False,
            optim="adamw_torch",
            report_to="none",
            logging_steps=1,
            save_strategy="no",
            eval_strategy="no",
            packing=False,
            dataset_num_proc=None,
            dataloader_num_workers=0,
        )
        trainer = SFTTrainer(
            model=model,
            args=config,
            processing_class=tokenizer,
            train_dataset=Dataset.from_list(training),
            eval_dataset=Dataset.from_list(evaluation),
            peft_config=LoraConfig(
                r=recipe.config["lora_rank"],
                lora_alpha=recipe.config["lora_rank"] * 2,
                target_modules="all-linear",
                task_type="CAUSAL_LM",
            ),
        )
        before = trainer.evaluate()["eval_loss"]
        trainer.train()
        after = trainer.evaluate()["eval_loss"]
        # Save only the portable adapter, never Trainer's pickled training_args.bin.
        trainer.model.save_pretrained(output, safe_serialization=True)
        tokenizer.save_pretrained(output)
        lineage = {
            "relationship": "adapter-for",
            "base": recipe.document["inputs"]["generator"],
            "dataset": recipe.document["inputs"]["dataset"],
            "recipe_sha256": recipe.sha256,
            "evaluation": "held-out loss on deduplicated split; not a task-quality benchmark",
        }
        (output / "superii-lineage.json").write_bytes(canonical(lineage) + b"\n")
        adapter_config = output / "adapter_config.json"
        saved = json.loads(adapter_config.read_text())
        saved["base_model_name_or_path"] = recipe.document["inputs"]["generator"]["repository"]
        adapter_config.write_bytes(canonical(saved) + b"\n")
        (output / "README.md").write_text(
            "# Super ii LoRA adapter\n\n"
            + "Base: "
            + recipe.document["inputs"]["generator"]["repository"]
            + "\n"
            + "Revision: "
            + recipe.document["inputs"]["generator"]["revision"]
            + "\n\n"
            + "Load with an explicitly acquired and verified base model. "
            + "Training results are reported evidence, not independently verified quality.\n"
        )
        artifacts = {
            item.relative_to(output).as_posix(): item
            for item in output.rglob("*")
            if item.is_file()
        }
        return run.finish(
            metrics={
                **planned,
                "train_rows": len(training),
                "held_out_rows": len(evaluation),
                "initial_eval_loss": before,
                "final_eval_loss": after,
                "max_steps": recipe.config["max_steps"],
            },
            artifacts=artifacts,
        )
    except Exception as error:
        run.finish(error=type(error).__name__ + ": training failed; inspect the local error")
        raise


def load_adapter(
    recipe: Recipe, client: Client, report: Path, *, directory: Path = Path("adapter")
):
    """Load recorded LoRA output onto its explicitly verified CPU base model."""
    from dataclasses import replace

    from peft import PeftModel

    from ..errors import IntegrityError
    from ..manifest import safe_path
    from ..model import Model
    from ..planner import plan
    from .contracts import validate_document

    run = json.loads(report.read_text())
    validate_document("superii-run-v1.json", run)
    if (
        recipe.document["outcome"] != "sft"
        or recipe.document["target"]["accelerator"] != "cpu"
        or run["stage"] != "train"
        or run["status"] != "completed"
        or run["recipe_sha256"] != recipe.sha256
    ):
        raise ValueError("Use the completed CPU LoRA record for this exact recipe")
    directory = directory.resolve(strict=True)
    recorded = {row["path"] for row in run["artifacts"]}
    if not {"adapter_config.json", "adapter_model.safetensors"} <= recorded:
        raise IntegrityError("Adapter files are missing from the training record")
    for entry in run["artifacts"]:
        location = directory / safe_path(entry["path"])
        if location.is_symlink() or not location.resolve().is_relative_to(directory):
            raise IntegrityError("Invalid adapter artifact path")
        with location.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        if checksum != entry["sha256"] or location.stat().st_size != entry["size_bytes"]:
            raise IntegrityError("Adapter output changed")
    snapshot = recipe.acquire("generator", client)
    training_plan(recipe, snapshot)
    manifest = replace(
        snapshot.manifest,
        files=tuple(f for f in snapshot.manifest.files if f.path in snapshot.files),
    )
    selected = plan(
        manifest,
        replace(hardware(), accelerator="cpu", available_vram_bytes=0),
        runtime="transformers",
        context_size=recipe.config["context_size"],
    )
    model = Model(replace(snapshot, files=selected.files), selected)
    try:
        model._model = PeftModel.from_pretrained(
            model._model, directory, local_files_only=True
        ).eval()
        return model
    except Exception:
        model.close()
        raise
