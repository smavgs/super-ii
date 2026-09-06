"""Local random-weight fixture exercises actual Transformers and MLX adapters.

No provider model is downloaded, no catalogue entry is created, and outputs are
not an accuracy benchmark. Run in the SDK venv with both optional extras.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from dataclasses import replace
from pathlib import Path

import torch
from tokenizers import Tokenizer, models, pre_tokenizers
from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast

from superii.client import Snapshot
from superii.hardware import hardware
from superii.manifest import Manifest
from superii.model import Model
from superii.planner import plan


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="superii-native-smoke-") as directory:
        path = Path(directory)
        tokenizer = Tokenizer(
            models.WordLevel(
                {"<unk>": 0, "<s>": 1, "</s>": 2, "hello": 3, "world": 4, "local": 5},
                unk_token="<unk>",
            )
        )
        tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
        wrapped = PreTrainedTokenizerFast(
            tokenizer_object=tokenizer,
            unk_token="<unk>",
            bos_token="<s>",
            eos_token="</s>",
            pad_token="</s>",
        )
        wrapped.save_pretrained(path)
        torch.manual_seed(42)
        tiny = LlamaForCausalLM(
            LlamaConfig(
                vocab_size=6,
                hidden_size=16,
                intermediate_size=32,
                num_hidden_layers=1,
                num_attention_heads=2,
                num_key_value_heads=2,
                max_position_embeddings=512,
                bos_token_id=1,
                eos_token_id=2,
                pad_token_id=2,
            )
        )
        tiny.save_pretrained(path, safe_serialization=True)
        files = [
            {
                "path": p.name,
                "size_bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                "download_url": "https://fixture.example/" + p.name,
            }
            for p in sorted(path.iterdir())
            if p.is_file()
        ]
        checksum = hashlib.sha256(
            b"".join(
                f"{f['path']}\0{f['sha256']}\0{f['size_bytes']}\n".encode()
                for f in files
            )
        ).hexdigest()
        manifest = Manifest.parse(
            {
                "repository": {
                    "id": "local",
                    "owner": "fixture",
                    "slug": "tiny",
                    "visibility": "private",
                },
                "revision": {
                    "id": "local",
                    "commit_sha": "c" * 64,
                    "manifest_sha256": checksum,
                    "total_size_bytes": sum(f["size_bytes"] for f in files),
                },
                "files": files,
                "compatibility": {"architecture": "llama", "dtype": "float32"},
            },
            "https://fixture.example",
        )
        results = []
        for adapter in ("transformers", "mlx"):
            release = replace(
                manifest,
                compatibility={
                    **manifest.compatibility,
                    "mlx_compatible": adapter == "mlx",
                },
            )
            selected = plan(release, hardware(), runtime=adapter, context_size=512)
            snapshot = Snapshot(path, release, selected.files, 0)
            with Model(snapshot, selected) as loaded:
                answer = loaded.generate("hello", max_tokens=4)
                results.append(
                    {
                        "adapter": adapter,
                        "accelerator": selected.accelerator,
                        "generated_text": isinstance(answer, str),
                        "verified_snapshot": snapshot.verify(),
                        "input_tokens": loaded.count_tokens("hello"),
                    }
                )
        print(
            json.dumps(
                {
                    "passed": True,
                    "scope": "tiny random local fixture; no accuracy claim",
                    "results": results,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
