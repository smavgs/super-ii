from __future__ import annotations

import json

from ..client import Snapshot
from ..errors import PlanError
from ..hardware import hardware

ENCODERS = frozenset({"bert", "roberta", "distilbert", "xlm-roberta"})


class Encoder:
    """Explicit mean pooling over a verified, built-in text encoder on CPU."""

    def __init__(self, snapshot: Snapshot, *, max_tokens: int = 512):
        import torch
        from transformers import AutoModel, AutoTokenizer

        snapshot.verify()
        if "config.json" not in snapshot.files:
            raise PlanError("The embedding recipe must include config.json")
        for name in ("config.json", "tokenizer_config.json", "modules.json"):
            location = snapshot.path / name
            if location.exists():
                if name not in snapshot.files or location.stat().st_size > 4 * 1024**2:
                    raise PlanError("Embedding configuration must be bounded and verified")
                value = json.loads(location.read_text())
                if isinstance(value, dict) and (
                    value.get("auto_map") or value.get("custom_pipelines")
                ):
                    raise PlanError("Custom embedding code is not supported")
                if name == "modules.json" and (
                    not isinstance(value, list)
                    or any(
                        not isinstance(module, dict)
                        or module.get("type")
                        not in {
                            "sentence_transformers.models.Transformer",
                            "sentence_transformers.models.Pooling",
                            "sentence_transformers.models.Normalize",
                        }
                        for module in value
                    )
                ):
                    raise PlanError("This embedding profile needs an unsupported transformation")
        configuration = json.loads((snapshot.path / "config.json").read_text())
        if configuration.get("model_type") not in ENCODERS or configuration.get("auto_map"):
            raise PlanError(
                "This recipe supports built-in BERT, RoBERTa, DistilBERT and XLM-R encoders"
            )
        pooling = snapshot.path / "1_Pooling/config.json"
        if pooling.exists():
            config = json.loads(pooling.read_text())
            enabled = [k for k, v in config.items() if k.startswith("pooling_mode_") and v is True]
            if enabled != ["pooling_mode_mean_tokens"]:
                raise PlanError(
                    "This recipe requires mean pooling; select a supported embedding profile"
                )
        weights = sum(
            f.size_bytes
            for f in snapshot.manifest.files
            if f.path in snapshot.files and f.path.endswith(".safetensors")
        )
        if not weights or weights * 5 + 512 * 1024**2 > hardware().available_ram_bytes * 0.7:
            raise PlanError("The embedding encoder does not fit the conservative CPU memory budget")
        self.tokenizer = AutoTokenizer.from_pretrained(
            snapshot.path, local_files_only=True, trust_remote_code=False
        )
        self.model = (
            AutoModel.from_pretrained(
                snapshot.path,
                local_files_only=True,
                trust_remote_code=False,
                use_safetensors=True,
                dtype=torch.float32,
            )
            .eval()
            .to("cpu")
        )
        self.max_tokens = min(
            max_tokens,
            int(configuration.get("max_position_embeddings", max_tokens)),
            int(self.tokenizer.model_max_length),
        )
        if self.max_tokens < 32:
            raise PlanError("The encoder context is too small for this recipe")
        self.snapshot = snapshot

    def encode(self, texts: list[str]):
        import numpy as np
        import torch

        if (
            not texts
            or len(texts) > 128
            or any(not isinstance(t, str) or len(t) > 32768 for t in texts)
        ):
            raise ValueError("Encode 1–128 bounded text strings at a time")
        result = []
        for start in range(0, len(texts), 16):
            batch = self.tokenizer(
                texts[start : start + 16],
                padding=True,
                truncation=True,
                max_length=self.max_tokens,
                return_tensors="pt",
            )
            with torch.inference_mode():
                vectors = self.model(**batch).last_hidden_state
                mask = batch["attention_mask"].unsqueeze(-1)
                mean = (vectors * mask).sum(1) / mask.sum(1).clamp(min=1)
                result.append(torch.nn.functional.normalize(mean, p=2, dim=1).numpy())
        return np.ascontiguousarray(np.concatenate(result), dtype="float32")
