"""Run the pinned Soup engine against a local tiny model with no network model access."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import torch
from peft import PeftModel
from tokenizers import Tokenizer, models, pre_tokenizers
from transformers import GPT2Config, GPT2LMHeadModel, PreTrainedTokenizerFast


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(command: list[str], *, cwd: Path) -> None:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout[-8000:]}\nstderr:\n{result.stderr[-8000:]}"
        )


def main() -> None:
    soup = shutil.which("soup")
    if not soup:
        raise RuntimeError("Run this verifier inside the frozen Soup project environment")
    torch.set_num_threads(2)
    torch.manual_seed(42)
    with tempfile.TemporaryDirectory(prefix="superii-soup-proof-") as temporary:
        root = Path(temporary)
        base = root / "base"
        output = root / "adapter"
        base.mkdir()
        vocabulary = {
            word: index
            for index, word in enumerate(
                [
                    "[PAD]",
                    "[UNK]",
                    "[EOS]",
                    "red",
                    "blue",
                    "green",
                    "apple",
                    "sky",
                    "water",
                    "answer",
                    "question",
                    "is",
                    "the",
                    "a",
                    "color",
                    "fruit",
                    ".",
                ]
            )
        }
        raw = Tokenizer(models.WordLevel(vocabulary, unk_token="[UNK]"))
        raw.pre_tokenizer = pre_tokenizers.Whitespace()
        tokenizer = PreTrainedTokenizerFast(
            tokenizer_object=raw,
            pad_token="[PAD]",
            unk_token="[UNK]",
            eos_token="[EOS]",
            model_max_length=64,
        )
        tokenizer.save_pretrained(base)
        GPT2LMHeadModel(
            GPT2Config(
                vocab_size=len(vocabulary),
                n_embd=16,
                n_layer=1,
                n_head=2,
                n_positions=64,
                bos_token_id=vocabulary["[EOS]"],
                eos_token_id=vocabulary["[EOS]"],
                pad_token_id=vocabulary["[PAD]"],
            )
        ).save_pretrained(base, safe_serialization=True)
        data = root / "train.jsonl"
        rows = [
            {"instruction": "", "input": "", "output": text}
            for text in (
                "red apple is a fruit .",
                "blue sky is the answer .",
                "water is blue .",
                "green apple is a fruit .",
                "the sky is blue .",
                "the apple is red .",
                "question color answer blue .",
                "question fruit answer apple .",
                "a fruit is an apple .",
                "a color is blue .",
                "red green blue are color .",
                "water and sky are blue .",
            )
        ]
        data.write_text("".join(json.dumps(row) + "\n" for row in rows))
        config = {
            "base": str(base),
            "task": "sft",
            "backend": "transformers",
            "data": {
                "train": str(data),
                "format": "alpaca",
                "chat_template": "chatml",
                "val_split": 0.0,
                "max_length": 64,
                "train_on_responses_only": False,
            },
            "training": {
                "epochs": 1,
                "lr": 0.0002,
                "batch_size": 2,
                "gradient_accumulation_steps": 1,
                "seed": 42,
                "data_seed": 42,
                "quantization": "none",
                "scheduler": "linear",
                "warmup_ratio": 0.0,
                "weight_decay": 0.0,
                "logging_steps": 1,
                "save_steps": 1_000_000,
                "lora": {"r": 2, "alpha": 4, "dropout": 0.05, "target_modules": "auto"},
            },
            "output": str(output),
        }
        config_path = root / "soup.json"
        config_path.write_text(json.dumps(config, sort_keys=True, separators=(",", ":")))
        command = [soup, "train", "--config", str(config_path), "--yes"]
        run([*command, "--dry-run"], cwd=root)
        run(command, cwd=root)
        adapter_config = output / "adapter_config.json"
        adapter_weights = output / "adapter_model.safetensors"
        if not adapter_config.is_file() or not adapter_weights.is_file():
            raise RuntimeError("Soup did not emit the required safe LoRA files")
        restored = GPT2LMHeadModel.from_pretrained(
            base, local_files_only=True, use_safetensors=True, dtype=torch.float32
        )
        restored = PeftModel.from_pretrained(restored, output, local_files_only=True).eval()
        prompt = tokenizer("blue sky is", return_tensors="pt")
        with torch.no_grad():
            generated = restored.generate(
                **prompt,
                do_sample=False,
                max_new_tokens=1,
                pad_token_id=tokenizer.pad_token_id,
            )
        produced = int(generated.shape[-1] - prompt["input_ids"].shape[-1])
        if produced != 1:
            raise RuntimeError("Reloaded adapter did not complete the bounded generation probe")
        print(
            json.dumps(
                {
                    "state": "verified",
                    "fixture": "local-tiny-gpt2",
                    "network_model_download": False,
                    "dry_run": True,
                    "training": True,
                    "adapter_reload": True,
                    "generated_tokens": produced,
                    "adapter_sha256": digest(adapter_weights),
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
