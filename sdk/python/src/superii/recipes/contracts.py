from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import time
from contextlib import nullcontext
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from uuid import uuid4

import rfc8785
from jsonschema import Draft202012Validator, FormatChecker

from ..client import Client, Snapshot
from ..errors import IntegrityError
from ..manifest import safe_path
from .access import input_headers


def canonical(value: object) -> bytes:
    return rfc8785.dumps(value)


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def validate_document(name: str, value: dict) -> None:
    schema = json.loads(files("superii.recipes").joinpath("schemas", name).read_text())
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)


class Recipe:
    def __init__(self, value: dict):
        validate_document("superii-recipe-v1.json", value)
        expected = digest({k: v for k, v in value.items() if k != "recipe_sha256"})
        if expected != value["recipe_sha256"]:
            raise IntegrityError(
                "Recipe checksum differs; regenerate after changing inputs or settings"
            )
        config = value["configuration"]
        if config["chunk_overlap"] >= config["chunk_size"]:
            raise ValueError("Chunk overlap must be smaller than chunk size")
        if config["max_tokens"] + 256 >= config["context_size"]:
            raise ValueError("Reserve context for the question, source passages and answer")
        inputs = value["inputs"]
        if inputs["generator"]["kind"] != "model":
            raise ValueError("The generator must reference a model")
        if value["outcome"] == "rag" and inputs["embedding"] is None:
            raise ValueError("RAG needs an immutable embedding model")
        if value["outcome"] == "sft" and inputs["dataset"] is None:
            raise ValueError("SFT needs an immutable dataset")
        if inputs["embedding"] and inputs["embedding"]["kind"] != "model":
            raise ValueError("Embeddings need a model")
        if inputs["dataset"] and inputs["dataset"]["kind"] != "dataset":
            raise ValueError("Dataset input has the wrong kind")
        for artifact in inputs.values():
            if artifact:
                for item in artifact["files"]:
                    safe_path(item)
        self.document = json.loads(canonical(value))

    @classmethod
    def read(cls, location: str | Path = "superii-recipe.json") -> Recipe:
        location = Path(location)
        if location.stat().st_size > 1024**2:
            raise ValueError("Recipe exceeds 1 MiB")
        return cls(json.loads(location.read_text()))

    @property
    def sha256(self) -> str:
        return self.document["recipe_sha256"]

    @property
    def config(self) -> dict:
        return self.document["configuration"]

    def _client_for(self, role: str, client: Client):
        if role not in {"generator", "embedding", "dataset"}:
            raise ValueError("Unknown recipe input")
        if not os.environ.get(f"SUPERII_{role.upper()}_TOKEN"):
            return nullcontext(client)
        token = input_headers(client.base_url)[f"x-superii-{role}-token"]
        return Client(
            client.base_url,
            token=token,
            cache_dir=client.cache.parent,
            workers=client.workers,
            peers=client.peers,
            trusted_keys=client.trusted_keys,
            require_attestation=client.require_attestation,
        )

    def inspect(self, role: str, client: Client):
        ref = self.document["inputs"].get(role)
        if not ref:
            raise ValueError(f"Recipe has no {role} input")
        with self._client_for(role, client) as scoped:
            manifest = scoped.inspect(ref["repository"], kind=ref["kind"], revision=ref["revision"])
        if manifest.manifest_sha256 != ref["manifest_sha256"]:
            raise IntegrityError("Recipe input manifest changed")
        return manifest

    def acquire(
        self, role: str, client: Client, *, selected_files: tuple[str, ...] | None = None
    ) -> Snapshot:
        ref = self.document["inputs"].get(role)
        if not ref:
            raise ValueError(f"Recipe has no {role} input")
        chosen = selected_files or tuple(ref["files"])
        if not set(chosen) <= set(ref["files"]):
            raise IntegrityError("Selection is outside the recipe input")
        with self._client_for(role, client) as scoped:
            snapshot = scoped.pull(
                ref["repository"], kind=ref["kind"], revision=ref["revision"], files=chosen
            )
        if snapshot.manifest.manifest_sha256 != ref["manifest_sha256"]:
            raise IntegrityError("Recipe input manifest changed")
        return snapshot


class RunRecord:
    """An explicit execution report; it never grants a verified quality badge."""

    def __init__(self, recipe: Recipe, stage: str, *, directory: Path = Path("runs")):
        self.recipe = recipe
        self.stage = stage
        self.directory = directory
        self.started = datetime.now(UTC)
        self.timer = time.monotonic()
        self.run_id = str(uuid4())

    def finish(
        self,
        *,
        metrics: dict | None = None,
        artifacts: dict[str, Path] | None = None,
        error: str | None = None,
    ) -> Path:
        records = []
        for name, item in sorted((artifacts or {}).items()):
            safe_path(name)
            if item.is_symlink() or not item.is_file():
                raise ValueError("Run artifacts must be regular files")
            sha = hashlib.sha256()
            with item.open("rb") as stream:
                while chunk := stream.read(1024**2):
                    sha.update(chunk)
            records.append(
                {"path": name, "sha256": sha.hexdigest(), "size_bytes": item.stat().st_size}
            )
        measurements = metrics or {}
        if any(isinstance(v, float) and not math.isfinite(v) for v in measurements.values()):
            raise ValueError("Metrics must be finite")
        environment = {
            "python": platform.python_version(),
            "system": platform.system(),
            "machine": platform.machine(),
        }
        for package in ("superii-sdk", "torch", "transformers", "peft", "trl", "faiss-cpu"):
            try:
                environment[package] = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                pass
        report = {
            "schema": "https://superii.site/schemas/superii-run-v1.json",
            "run_id": self.run_id,
            "recipe_sha256": self.recipe.sha256,
            "stage": self.stage,
            "status": "failed" if error else "completed",
            "started_at": self.started.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
            "duration_seconds": time.monotonic() - self.timer,
            "evidence": {"classification": "reported", "independent_verification": False},
            "environment": environment,
            "metrics": measurements,
            "artifacts": records,
            "error": error[:500] if error else None,
        }
        validate_document("superii-run-v1.json", report)
        target = self.directory / self.run_id
        target.mkdir(mode=0o700, parents=True, exist_ok=False)
        output = target / "superii-run.json"
        output.write_bytes(canonical(report) + b"\n")
        output.chmod(0o600)
        return output
