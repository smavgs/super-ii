"""Exercise the generated Super ii Soup runner with immutable local snapshots."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

import torch
from tokenizers import Tokenizer, models, pre_tokenizers
from transformers import GPT2Config, GPT2LMHeadModel, PreTrainedTokenizerFast

from superii.client import Snapshot
from superii.manifest import Manifest
from superii.recipes import Recipe
from superii.recipes.contracts import digest

ORIGIN = "https://superii.test"


def snapshot(directory: Path, *, repository: str, kind: str, architecture: str) -> Snapshot:
    files = {
        item.relative_to(directory).as_posix(): item.read_bytes()
        for item in directory.rglob("*")
        if item.is_file()
    }
    entries = [
        {
            "path": name,
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "download_url": f"{ORIGIN}/files/{name}",
        }
        for name, content in files.items()
    ]
    manifest_sha256 = hashlib.sha256(
        b"".join(
            f"{entry['path']}\0{entry['sha256']}\0{entry['size_bytes']}\n".encode()
            for entry in sorted(entries, key=lambda value: value["path"])
        )
    ).hexdigest()
    owner, slug = repository.split("/")
    manifest = Manifest.parse(
        {
            "repository": {
                "id": f"fixture-{kind}",
                "owner": owner,
                "slug": slug,
                "visibility": "public",
                "kind": kind,
            },
            "revision": {
                "id": f"fixture-{kind}-revision",
                "commit_sha": "c" * 64,
                "manifest_sha256": manifest_sha256,
                "total_size_bytes": sum(len(content) for content in files.values()),
            },
            "files": entries,
            "compatibility": {"architecture": architecture, "dtype": "float32"},
        },
        ORIGIN,
    )
    return Snapshot(directory, manifest, tuple(files), 0)


def reference(value: Snapshot) -> dict:
    return {
        "kind": value.manifest.kind,
        "repository": value.manifest.repository,
        "revision": value.manifest.revision,
        "manifest_sha256": value.manifest.manifest_sha256,
        "files": sorted(value.files),
    }


def load_runner(location: Path):
    spec = importlib.util.spec_from_file_location("superii_generated_soup_runner", location)
    if not spec or not spec.loader:
        raise RuntimeError("Could not load the generated Soup runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-soup-runner.py /path/to/generated/train.py")
    runner = load_runner(Path(sys.argv[1]).resolve())
    torch.set_num_threads(2)
    torch.manual_seed(42)
    with tempfile.TemporaryDirectory(prefix="superii-soup-runner-") as temporary:
        root = Path(temporary)
        model_directory = root / "base"
        dataset_directory = root / "dataset"
        model_directory.mkdir()
        dataset_directory.mkdir()
        words = [
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
        vocabulary = {word: index for index, word in enumerate(words)}
        raw = Tokenizer(models.WordLevel(vocabulary, unk_token="[UNK]"))
        raw.pre_tokenizer = pre_tokenizers.Whitespace()
        tokenizer = PreTrainedTokenizerFast(
            tokenizer_object=raw,
            pad_token="[PAD]",
            unk_token="[UNK]",
            eos_token="[EOS]",
            model_max_length=64,
        )
        tokenizer.save_pretrained(model_directory)
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
        ).save_pretrained(model_directory, safe_serialization=True)
        texts = (
            "red apple is a fruit .",
            "blue sky is the answer .",
            "water is blue .",
            "green apple is a fruit .",
            "the sky is blue .",
            "the apple is red .",
            "question color answer blue .",
            "question fruit answer apple .",
            "a fruit is apple .",
            "a color is blue .",
            "red green blue color .",
            "water sky blue .",
        )
        (dataset_directory / "data.jsonl").write_text(
            "".join(json.dumps({"text": text}) + "\n" for text in texts)
        )
        model = snapshot(
            model_directory,
            repository="fixture/base",
            kind="model",
            architecture="GPT2LMHeadModel",
        )
        dataset = snapshot(
            dataset_directory,
            repository="fixture/dataset",
            kind="dataset",
            architecture="dataset",
        )
        value = {
            "schema": "https://superii.site/schemas/superii-recipe-v1.json",
            "recipe_version": 1,
            "outcome": "sft",
            "template": {"id": "superii-sft-soup", "version": "1.0.0"},
            "inputs": {"generator": reference(model), "embedding": None, "dataset": reference(dataset)},
            "target": {"accelerator": "cpu", "python": "3.12", "runtime": "transformers"},
            "configuration": {
                "chunk_size": 256,
                "chunk_overlap": 32,
                "top_k": 3,
                "context_size": 512,
                "max_tokens": 32,
                "min_score": -1,
                "embedding_max_tokens": 128,
                "query_prefix": "",
                "document_prefix": "",
                "seed": 42,
                "max_steps": 1,
                "batch_size": 2,
                "gradient_accumulation_steps": 1,
                "sequence_length": 64,
                "lora_rank": 2,
                "learning_rate": 0.0002,
                "adapter": "lora",
                "framework": "python",
                "ui": "none",
                "observability": False,
            },
            "dependencies": {
                "superii-sdk": "0.3.0",
                "training-engine": "soup@0.75.1",
                "training-epochs": "1",
            },
            "verification": {
                "scope": "template-fixture-tests",
                "model_quality": "not-established",
                "hardware": ["cpu"],
            },
        }
        value["recipe_sha256"] = digest(value)
        recipe = Recipe(value)

        def acquire(self, role: str, _client):
            return model if role == "generator" else dataset

        recipe.acquire = types.MethodType(acquire, recipe)
        runner.SOUP_PROJECT = Path(sys.argv[1]).resolve().parent / "soup"
        runner.WORK_DIRECTORY = root / ".superii" / "soup"
        runner.OUTPUT_DIRECTORY = root / "adapter"
        report_path = runner.train_with_soup(
            recipe,
            object(),
            run_directory=root / "runs",
        )
        report = json.loads(report_path.read_text())
        metrics = report["metrics"]
        if report["status"] != "completed" or not metrics.get("verified_reload"):
            raise RuntimeError("The generated runner did not record a verified reload")
        if metrics.get("reload_probe_generated_tokens") != 1:
            raise RuntimeError("The generated runner did not complete its bounded probe")
        if not (root / "adapter" / "superii-lineage.json").is_file():
            raise RuntimeError("The generated runner did not bind immutable lineage")
        unsafe_output = root / "unsafe-adapter"
        unsafe_output.mkdir()
        (unsafe_output / "adapter_config.json").symlink_to(
            root / "adapter" / "adapter_config.json"
        )
        runner.OUTPUT_DIRECTORY = unsafe_output
        try:
            runner._sanitize_adapter(recipe, metrics["engine_version"], metrics["engine_config_sha256"])
        except runner.IntegrityError:
            pass
        else:
            raise RuntimeError("The generated runner accepted a symlinked adapter output")
        print(
            json.dumps(
                {
                    "state": "verified",
                    "generated_runner": True,
                    "soup_version": metrics["engine_version"],
                    "training": True,
                    "adapter_reload": True,
                    "generated_tokens": metrics["reload_probe_generated_tokens"],
                    "train_rows": metrics["train_rows"],
                    "held_out_rows": metrics["held_out_rows"],
                    "initial_eval_loss": metrics["initial_eval_loss"],
                    "final_eval_loss": metrics["final_eval_loss"],
                    "engine_config_sha256": metrics["engine_config_sha256"],
                    "recipe_sha256": recipe.sha256,
                    "model_quality_claim": metrics["model_quality_claim"],
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
